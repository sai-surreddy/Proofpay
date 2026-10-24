// PayPal REST integration (SANDBOX ONLY).
//   Funding:  Orders v2  -> the client pays the full agreement into the platform account.
//   Release:  Payouts v1 -> each verified milestone is paid out to the payee.
//   Return:   Captures refund -> cancelled milestones go back to the client.
// Production note: holding funds for third parties is regulated (escrow / money transmission).
// A real launch would use PayPal's marketplace flows (e.g. delayed disbursement) plus licensing.

const BASE = "https://api-m.sandbox.paypal.com";

export function paypalEnabled() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

export class PayPalError extends Error {
  constructor(status, body) {
    const detail =
      body?.details?.[0]?.description || body?.message || body?.error_description || JSON.stringify(body);
    super(`PayPal ${status}: ${detail}`);
    this.status = status;
    this.body = body;
  }
}

let cachedToken = null;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError(res.status, body);
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function api(method, path, body, requestId) {
  const headers = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId; // idempotency key
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError(res.status, json);
  return json;
}

const money = (cents) => (cents / 100).toFixed(2);

export async function createOrder({ projectId, amountCents, currency, description }) {
  const order = await api(
    "POST",
    "/v2/checkout/orders",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: projectId,
          description: description.slice(0, 127),
          amount: { currency_code: currency, value: money(amountCents) },
        },
      ],
    },
    `order-${projectId}-${Date.now()}`
  );
  return { orderId: order.id, status: order.status };
}

export async function captureOrder(orderId) {
  const result = await api("POST", `/v2/checkout/orders/${orderId}/capture`, {}, `capture-${orderId}`);
  const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: result.status,
    captureId: capture?.id,
    captureStatus: capture?.status,
    payerEmail: result.payer?.email_address,
  };
}

export async function sendPayout({ batchId, receiverEmail, amountCents, currency, note, itemId }) {
  const result = await api(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: "ProofPay: your milestone payment was released",
        email_message: note.slice(0, 1000),
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: receiverEmail,
          amount: { value: money(amountCents), currency },
          note: note.slice(0, 4000),
          sender_item_id: itemId,
        },
      ],
    },
    batchId
  );
  return { payoutBatchId: result.batch_header?.payout_batch_id, status: result.batch_header?.batch_status };
}

export async function getPayout(payoutBatchId) {
  const result = await api("GET", `/v1/payments/payouts/${payoutBatchId}`);
  const item = result.items?.[0];
  return {
    status: result.batch_header?.batch_status,
    itemStatus: item?.transaction_status,
    transactionId: item?.transaction_id,
  };
}

export async function refundCapture({ captureId, amountCents, currency, note, requestId }) {
  const result = await api(
    "POST",
    `/v2/payments/captures/${captureId}/refund`,
    { amount: { value: money(amountCents), currency_code: currency }, note_to_payer: note.slice(0, 255) },
    requestId
  );
  return { refundId: result.id, status: result.status };
}
