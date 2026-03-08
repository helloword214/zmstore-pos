declare module "nodemailer" {
  export type TransportAuth = {
    user?: string;
    pass?: string;
  };

  export type TransportOptions = {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: TransportAuth;
  };

  export type SendMailOptions = {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
  };

  export type Transporter = {
    sendMail(options: SendMailOptions): Promise<unknown>;
  };

  const nodemailer: {
    createTransport(options?: TransportOptions): Transporter;
  };

  export default nodemailer;
}
