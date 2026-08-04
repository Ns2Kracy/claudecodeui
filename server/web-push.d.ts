declare module 'web-push' {
  type WebPushSubscription = {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };

  type WebPushClient = {
    sendNotification(
      subscription: WebPushSubscription,
      payload: string,
    ): Promise<unknown>;
  };

  const webPush: WebPushClient;
  export default webPush;
}
