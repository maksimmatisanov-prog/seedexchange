import { config } from '../src/config.js';
import { productionMailFailureCode } from '../src/domain/production-mail.js';
import { createConfiguredMailTransport } from '../src/services/mail-transport.js';

let transport: ReturnType<typeof createConfiguredMailTransport> | null = null;
try {
  transport = createConfiguredMailTransport();
  await transport.verify();
  console.log(JSON.stringify({ ready: true, encryption: config.MAIL_ENCRYPTION, port: config.MAIL_PORT, authenticationConfigured: true, errors: [] }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ ready: false, encryption: config.MAIL_ENCRYPTION, port: config.MAIL_PORT, authenticationConfigured: Boolean(config.MAIL_USER && config.MAIL_PASS), failureCode: productionMailFailureCode(error), errors: ['SMTP connection and authentication verification failed.'] }, null, 2));
  process.exitCode = 1;
} finally {
  transport?.close();
}
