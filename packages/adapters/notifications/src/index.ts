export type {
  NotificationDriverName,
  NotificationMessage,
  NotificationRecipient,
  NotificationSender,
  OutboundChannel,
  SendResult,
} from "./contract";

export { NotificationError, isNotificationError, type NotificationErrorKind } from "./errors";

export {
  createNotificationSender,
  isNotificationDriver,
  resetNotificationSender,
  type NotificationConfig,
} from "./factory";

export { LogNotificationSender, type LogNotificationOptions } from "./drivers/log";
export {
  EmailNotificationSender,
  type EmailNotificationConfig,
  type EmailPayload,
} from "./drivers/email";
