import { execFile, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { productionMailFailureCode } from '../../src/domain/production-mail.js';

const execFileAsync = promisify(execFile);

describe('production SMTP preflight', () => {
  it('exposes only allowlisted failure codes', () => {
    expect(productionMailFailureCode({ code: 'EAUTH', message: 'secret details' })).toBe('EAUTH');
    expect(productionMailFailureCode({ code: 'PRIVATE_PROVIDER_ERROR', message: 'secret details' })).toBe('SMTP_VERIFICATION_FAILED');
    expect(productionMailFailureCode(new Error('secret details'))).toBe('SMTP_VERIFICATION_FAILED');
  });

  it('shares one transport configuration and never sends a preflight message', async () => {
    const transport = await readFile(path.resolve('src/services/mail-transport.ts'), 'utf8');
    const outbox = await readFile(path.resolve('scripts/send-outbox.ts'), 'utf8');
    const preflight = await readFile(path.resolve('scripts/verify-production-mail.ts'), 'utf8');
    expect(outbox).toContain('createConfiguredMailTransport()');
    expect(preflight).toContain('createConfiguredMailTransport()');
    expect(preflight).toContain('await transport.verify()');
    expect(preflight).not.toContain('sendMail');
    expect(transport).toContain('connectionTimeout: 5_000');
    expect(transport).not.toContain('rejectUnauthorized: false');
  });

  it('fails through the operational CLI without echoing credentials', async () => {
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const execution = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('scripts/verify-production-mail.ts')], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', MAIL_HOST: '127.0.0.1', MAIL_PORT: String(port), MAIL_ENCRYPTION: 'none', MAIL_USER: 'private-user', MAIL_PASS: 'private-password', MAIL_FROM: 'private@example.test' },
    });
    expect(execution.status, execution.stderr).toBe(1);
    expect(JSON.parse(execution.stdout)).toMatchObject({ ready: false, authenticationConfigured: true, errors: ['SMTP connection and authentication verification failed.'] });
    expect(execution.stdout).not.toContain('private-user');
    expect(execution.stdout).not.toContain('private-password');
    expect(execution.stdout).not.toContain('private@example.test');
  });

  it('authenticates through the operational CLI without sending a message', async () => {
    const commands: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.write('220 localhost test SMTP\r\n');
      let buffer = '';
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        while (buffer.includes('\r\n')) {
          const boundary = buffer.indexOf('\r\n');
          const command = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          commands.push(command);
          if (/^EHLO /i.test(command)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
          else if (/^AUTH PLAIN /i.test(command)) socket.write('235 2.7.0 Authentication successful\r\n');
          else if (/^QUIT$/i.test(command)) { socket.write('221 2.0.0 Bye\r\n'); socket.end(); }
          else socket.write('500 5.5.1 Unsupported command\r\n');
        }
      });
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address.');
    try {
      const execution = await execFileAsync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('scripts/verify-production-mail.ts')], {
        cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', MAIL_HOST: '127.0.0.1', MAIL_PORT: String(address.port), MAIL_ENCRYPTION: 'none', MAIL_USER: 'private-user', MAIL_PASS: 'private-password', MAIL_FROM: 'private@example.test' },
      });
      expect(JSON.parse(execution.stdout)).toMatchObject({ ready: true, encryption: 'none', port: address.port, authenticationConfigured: true, errors: [] });
      expect(commands.some((command) => /^AUTH PLAIN /i.test(command))).toBe(true);
      expect(commands.some((command) => /^(MAIL FROM|RCPT TO|DATA)/i.test(command))).toBe(false);
      expect(execution.stdout).not.toContain('private-user');
      expect(execution.stdout).not.toContain('private-password');
      expect(execution.stdout).not.toContain('private@example.test');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
