export {
  NotificationServiceError,
  isNotificationServiceError,
  type NotificationIssue,
  type NotificationServiceErrorCode,
} from "./errors";

export {
  listNotifications,
  markNotificationsRead,
  markReadSchema,
  readNotification,
  unreadNotificationCount,
  type InboxContext,
  type ListNotificationsOptions,
  type MarkReadInput,
  type NotificationInbox,
  type NotificationView,
} from "./inbox-service";

export { deliverEventNotifications, type FanOutOptions, type FanOutResult } from "./fanout";

export {
  resolveRecipients,
  type NotificationRecipientRow,
  type ResolveRecipientsInput,
} from "./recipients";

export { getNotificationSender, portalUrl } from "./adapters";
