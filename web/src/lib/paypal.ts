/**
 * PayPal Orders v2 API (REST with fetch).
 * No SDK dependency; uses PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MODE (sandbox | live).
 */

const PAYPAL_API_BASE =
  process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !secret) {
    throw new Error("PayPal: missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
  }
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal token failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal: no access_token in response");
  return data.access_token;
}

export type CreateOrderParams = {
  amountUsd: string;
  customId: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
};

export async function createPayPalOrder(params: CreateOrderParams): Promise<{
  orderId: string;
  approvalUrl: string;
}> {
  const token = await getPayPalAccessToken();
  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { currency_code: "USD", value: params.amountUsd },
        description: params.description.slice(0, 127),
        custom_id: params.customId.slice(0, 127),
      },
    ],
    application_context: {
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
      brand_name: (process.env.PAYPAL_BRAND_NAME ?? "Credits").slice(0, 127),
      user_action: "PAY_NOW",
    },
  };
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal create order failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as {
    id?: string;
    links?: Array< { rel?: string; href?: string } >;
  };
  if (!data.id) throw new Error("PayPal: no order id in response");
  const approveLink = data.links?.find((l) => l.rel === "approve" || l.rel === "payer-action");
  const rawHref = approveLink?.href ?? null;
  const baseHost =
    process.env.PAYPAL_MODE === "live"
      ? "https://www.paypal.com"
      : "https://www.sandbox.paypal.com";
  const approvalUrl =
    rawHref && (rawHref.startsWith("http://") || rawHref.startsWith("https://"))
      ? rawHref
      : `${baseHost}/checkoutnow?token=${data.id}`;
  return { orderId: data.id, approvalUrl };
}

export async function capturePayPalOrder(orderId: string): Promise<{ status: string }> {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: "{}",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal capture failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { status?: string };
  return { status: data.status ?? "UNKNOWN" };
}

/** PayPal Subscriptions API (v1) - 정기 결제 */
export type CreateSubscriptionParams = {
  planIdPayPal: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
};

export async function createPayPalSubscription(
  params: CreateSubscriptionParams
): Promise<{ subscriptionId: string; approvalUrl: string }> {
  const token = await getPayPalAccessToken();
  const body = {
    plan_id: params.planIdPayPal,
    custom_id: params.customId.slice(0, 127),
    application_context: {
      brand_name: (process.env.PAYPAL_BRAND_NAME ?? "Credits").slice(0, 127),
      locale: "en-US",
      user_action: "SUBSCRIBE_NOW",
      return_url: params.returnUrl,
      cancel_url: params.cancelUrl,
    },
  };
  const res = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal create subscription failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as {
    id?: string;
    status?: string;
    links?: Array<{ rel?: string; href?: string }>;
  };
  if (!data.id) throw new Error("PayPal: no subscription id in response");
  const approveLink = data.links?.find((l) => l.rel === "approve");
  const approvalUrl =
    approveLink?.href && (approveLink.href.startsWith("http://") || approveLink.href.startsWith("https://"))
      ? approveLink.href
      : `${process.env.PAYPAL_MODE === "live" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com"}/webapps/billing/subscriptions?ba_token=${data.id}`;
  return { subscriptionId: data.id, approvalUrl };
}

export async function getPayPalSubscription(subscriptionId: string): Promise<{
  status: string;
  plan_id?: string;
  custom_id?: string;
}> {
  const token = await getPayPalAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal get subscription failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { status?: string; plan_id?: string; custom_id?: string };
  return {
    status: data.status ?? "UNKNOWN",
    plan_id: data.plan_id,
    custom_id: data.custom_id,
  };
}

/**
 * Cancel a PayPal subscription. User keeps access until period end; no further charges.
 */
export async function cancelPayPalSubscription(
  subscriptionId: string,
  reason?: string
): Promise<void> {
  const token = await getPayPalAccessToken();
  const body = reason ? { reason: reason.slice(0, 256) } : {};
  const res = await fetch(`${PAYPAL_API_BASE}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal cancel subscription failed: ${res.status} ${t}`);
  }
}

/**
 * PayPal Webhook 서명 검증.
 * PAYPAL_WEBHOOK_ID env 필수. 미설정 시 항상 실패.
 */
export async function verifyPayPalWebhookSignature(params: {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  webhookId: string;
  body: unknown;
}): Promise<boolean> {
  const token = await getPayPalAccessToken();
  const res = await fetch(
    `${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        transmission_id: params.transmissionId,
        transmission_time: params.transmissionTime,
        transmission_sig: params.transmissionSig,
        cert_url: params.certUrl,
        auth_algo: "SHA256withRSA",
        webhook_id: params.webhookId,
        webhook_event: params.body,
      }),
    }
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}

/**
 * PayPal Payouts API (single recipient).
 * Requires PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET; app may need Payouts permission in PayPal Developer.
 */
export async function createPayPalPayout(params: {
  amountUsd: number;
  receiverEmail: string;
  senderBatchId: string;
  note?: string;
}): Promise<{ batchId: string; status: string }> {
  const token = await getPayPalAccessToken();
  const value = Math.round(params.amountUsd * 100) / 100;
  if (value <= 0) throw new Error("PayPal payout amount must be positive");
  const body = {
    sender_batch_header: {
      sender_batch_id: params.senderBatchId.slice(0, 64),
      email_subject: "You have a reward payout",
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: String(value), currency_code: "USD" },
        receiver: params.receiverEmail.trim(),
        note: (params.note ?? "Reward withdrawal").slice(0, 255),
        sender_item_id: params.senderBatchId.slice(0, 32),
      },
    ],
  };
  const res = await fetch(`${PAYPAL_API_BASE}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal payout failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { batch_header?: { payout_batch_id?: string; batch_status?: string } };
  const batchId = data.batch_header?.payout_batch_id ?? "";
  const status = data.batch_header?.batch_status ?? "UNKNOWN";
  return { batchId, status };
}
