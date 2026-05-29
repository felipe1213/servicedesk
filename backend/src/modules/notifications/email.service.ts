import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { NotificationConfigService } from './notification-config.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly notificationConfig: NotificationConfigService) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    let emailConfig: { transport: 'SMTP' | 'GRAPH' | 'NONE'; config: Record<string, unknown> };
    try {
      emailConfig = await this.notificationConfig.getEmailConfig();
    } catch (err) {
      this.logger.warn('Failed to load email config — skipping email send', err);
      return;
    }

    if (emailConfig.transport === 'NONE') {
      this.logger.warn('Email transport not configured — skipping email send');
      return;
    }

    if (emailConfig.transport === 'SMTP') {
      await this.sendSmtp(to, subject, body, emailConfig.config);
    } else if (emailConfig.transport === 'GRAPH') {
      await this.sendGraph(to, subject, body, emailConfig.config);
    }
  }

  private async sendSmtp(
    to: string,
    subject: string,
    body: string,
    cfg: Record<string, unknown>,
  ): Promise<void> {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host as string,
        port: cfg.port as number,
        secure: cfg.secure as boolean,
        auth: { user: cfg.user as string, pass: cfg.pass as string },
      });
      await transporter.sendMail({
        from: cfg.fromAddress as string,
        to,
        subject,
        text: body,
      });
    } catch (err) {
      this.logger.error(`SMTP send failed to ${to}`, err);
    }
  }

  private async sendGraph(
    to: string,
    subject: string,
    body: string,
    cfg: Record<string, unknown>,
  ): Promise<void> {
    try {
      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: cfg.clientId as string,
            client_secret: cfg.clientSecret as string,
            scope: 'https://graph.microsoft.com/.default',
          }),
        },
      );
      const tokenData = (await tokenRes.json()) as { access_token: string };

      await fetch(
        `https://graph.microsoft.com/v1.0/users/${cfg.fromAddress}/sendMail`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }],
            },
          }),
        },
      );
    } catch (err) {
      this.logger.error(`Graph send failed to ${to}`, err);
    }
  }
}
