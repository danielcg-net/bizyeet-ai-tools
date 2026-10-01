import { refreshAccessToken, revokeRefreshToken, type FetchLike, type OAuthMetadata } from "./oauth.js";
import { isCommittedCredentialCleanupFailure } from "./credential-store.js";
import { isUncertainCredentialPersistence, uncertainCredentialPersistenceError } from "./credential-cleanup.js";
import { validOAuthScope } from "./oauth-scope.js";
import { validMarginReportOptions, type MarginReportOptions } from "./margin-report-contract.js";
import type { Profile, StoredCredentials } from "./profile-store.js";
import { createCanonicalCrmClient, validResourceId, type CanonicalCrmClient, type ListOptions, type ReadOptions, type CustomerUpdatePreview, type CustomerUpdateExecution, type CustomerUpdateStatusQuery, type QuoteCreatePreview, type QuoteUpdatePreview, type ServiceCreatePreview, type ServiceUpdatePreview, type ServiceTransitionPreview } from "./canonical-crm-client.js";
import { agentFailure } from "./agent-error.js";
import { AUTH_RESPONSE_BYTES, readBoundedJson } from "./bounded-json.js";
import { CRM_SEARCH_LIMIT_MESSAGE, validCrmSearch, validSalesSearch } from "./search-contract.js";
import { validCursor } from "./cursor.js";
import { validPaymentSummaryOptions, type PaymentSummaryOptions } from "./payment-summary-contract.js";
import { validTaxReportOptions, type TaxReportOptions } from "./tax-report-contract.js";
import { validPaymentQuery, type PaymentFilters } from "./payment-contract.js";
import { validExpenseListOptions, type ExpenseListOptions } from "./expense-contract.js";
import { validExpenseScheduleGetOptions, validExpenseScheduleListOptions, type ExpenseScheduleListOptions } from "./expense-schedule-contract.js";
import { validBookingSummaryOptions, type BookingSummaryOptions } from "./booking-contract.js";
import { validCommunicationOptions, validCommunicationResource, type CommunicationResource, type CommunicationOptions } from "./communication-contract.js";
import { validServiceReadFields } from "./service-read-contract.js";
import { validServiceHistoryOptions, type ServiceHistoryOptions } from "./service-history-contract.js";
import { validServicePaymentOptions, type ServicePaymentOptions } from "./service-payment-contract.js";
import { validQuoteReadFields } from "./quote-read-contract.js";
import { validCatalogReadFields } from "./catalog-read-contract.js";

export type CustomerListOptions = Readonly<{
  cursor?: string;
  fields?: readonly string[];
  limit?: number;
  search?: string;
}>;
export type PaymentListOptions = CustomerListOptions & PaymentFilters;

export type AgentResult = Readonly<{ credentials: StoredCredentials; response: unknown }>;
export type PersistCredentials = (credentials: StoredCredentials) => Promise<void>;
type MetadataSource = OAuthMetadata | (() => Promise<OAuthMetadata>);

export const refreshPersistenceMessages = {
  uncertain: uncertainCredentialPersistenceError().message,
  retained: "Rotated credentials were saved and access was retained, but credential storage cleanup failed. Check storage and abandoned locks before retrying.",
  revoked: "Rotated credentials could not be saved; the new grant was revoked. Repair credential storage, then run auth login again.",
  unconfirmed: "Rotated credentials could not be saved and revocation could not be confirmed. Revoke this agent in dashboard settings, repair credential storage, then sign in again.",
} as const;

const fieldPattern = /^[a-z][a-z0-9_]{0,63}$/u;
const boundedReadOptions = (options: ReadOptions): ReadOptions => {
  if (options.fields && (options.fields.length > 20 || !options.fields.every((field) => fieldPattern.test(field)))) throw new Error("Requested fields are invalid.");
  return options.fields?.length ? { fields: options.fields } : {};
};
const validTenantIdentifier = (value: unknown): value is string => typeof value === "string"
  && value.trim().length > 0 && value.length <= 512 && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);

const boundedOptions = (options: CustomerListOptions): ListOptions => {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100.");
  if (options.cursor && !validCursor(options.cursor)) throw new Error("Cursor is invalid.");
  if (options.search && !validCrmSearch(options.search)) throw new Error(CRM_SEARCH_LIMIT_MESSAGE);
  return {
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...boundedReadOptions(options),
    page_size: limit,
    ...(options.search ? { search: options.search } : {}),
  };
};

const currentCredentials = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<StoredCredentials> => {
  if (input.credentials.profile?.issuer !== input.profile.issuer
    || input.credentials.profile.clientId !== input.profile.clientId) {
    throw new Error("OAuth identity binding is missing or mismatched; run auth login again.");
  }
  if (new Date(input.credentials.expiresAt).getTime() > input.now() + 30000) return input.credentials;
  if (!input.credentials.refreshToken) throw new Error("OAuth session expired; run auth login again.");
  const metadata = typeof input.metadata === "function" ? await input.metadata() : input.metadata;
  const tokens = await refreshAccessToken({
    clientId: input.profile.clientId,
    fetcher: input.fetcher,
    metadata,
    refreshToken: input.credentials.refreshToken,
    resource: new URL(input.profile.issuer),
  });
  if (!tokens.refresh_token) throw new Error("OAuth refresh did not rotate a refresh token; run auth login again.");
  const credentials = {
    profile: input.credentials.profile,
    accessToken: tokens.access_token,
    expiresAt: new Date(input.now() + tokens.expires_in * 1000).toISOString(),
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? input.credentials.scope,
  };
  // A successful rotation consumes the old refresh token, even if the next
  // resource request fails. Persist before making that request.
  try { await input.persistCredentials(credentials); }
  catch (error) {
    if (isUncertainCredentialPersistence(error)) throw new Error(refreshPersistenceMessages.uncertain, { cause: error });
    if (isCommittedCredentialCleanupFailure(error)) throw new Error(refreshPersistenceMessages.retained, { cause: error });
    try {
      await revokeRefreshToken({ clientId: input.profile.clientId, fetcher: input.fetcher, metadata, refreshToken: credentials.refreshToken });
    } catch { throw new Error(refreshPersistenceMessages.unconfirmed); }
    throw new Error(refreshPersistenceMessages.revoked, { cause: error });
  }
  return credentials;
};

const invoke = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  operation: (client: CanonicalCrmClient, credentials: StoredCredentials) => ReturnType<CanonicalCrmClient["list"]>;
  retryUnauthorized?: boolean;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => {
  const initial = await currentCredentials(input);
  const execute = (credentials: StoredCredentials): ReturnType<CanonicalCrmClient["list"]> => input.operation(createCanonicalCrmClient({
    origin: input.profile.issuer,
    getAccessToken: () => Promise.resolve(credentials.accessToken),
    request: input.fetcher,
  }), credentials);
  const first = await execute(initial);
  const refreshed = input.retryUnauthorized !== false && first.status === 401 && initial === input.credentials
    ? await currentCredentials({ ...input, credentials: { ...input.credentials, expiresAt: new Date(0).toISOString() } })
    : initial;
  const response = first.status === 401 && refreshed !== initial ? await execute(refreshed) : first;
  if (response.status < 200 || response.status >= 300) throw new Error("Agent request failed.", { cause: agentFailure(response.status, response.body) });
  return { credentials: refreshed, response: response.body };
};

/** Checks current server authorization through the canonical identity endpoint, without reading business records. */
export const checkIdentity = (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => invoke({ ...input, operation: async (_client, credentials) => {
  const response = await input.fetcher(new URL("/api/agent/me", input.profile.issuer).toString(), {
    method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${credentials.accessToken}` },
    redirect: "error", signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) return { status: 503, body: { error: { code: "request_unavailable" } } };
  const body: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (!response.ok) return { status: response.status, body };
  if (typeof body !== "object" || body === null || !("tenant_id" in body) || !validTenantIdentifier(body.tenant_id)
      || !("client_id" in body) || body.client_id !== input.profile.clientId
      || !("scope" in body) || !Array.isArray(body.scope) || !body.scope.every((scope: unknown) => validOAuthScope(scope) && !scope.includes(" "))) {
    return { status: 502, body: { error: { code: "invalid_response" } } };
  }
  return { status: response.status, body: { data: {
    authenticated: true, verification: "server", tenant: body.tenant_id, scope: body.scope,
  }, meta: { contract_version: "v1", request_id: crypto.randomUUID() } } };
} });

/** Read canonical receipt totals through the shared OAuth refresh and persistence flow. */
export const receivedPaymentSummary = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  options: PaymentSummaryOptions;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => {
  if (!validPaymentSummaryOptions(input.options)) throw new Error("Payment summary options are invalid.");
  return invoke({ ...input, operation: (client) => client.receivedPaymentSummary(input.options) });
};

/** Read a bounded provider-aware booking summary through the canonical OAuth API. */
export const upcomingBookings = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options"> & Readonly<{ options: BookingSummaryOptions }>): Promise<AgentResult> => {
  if (!validBookingSummaryOptions(input.options)) throw new Error("Booking summary options are invalid.");
  return invoke({ ...input, operation: (client) => client.bookingSummary(input.options) });
};

/** Read configured booking capabilities without selecting a provider or executing a booking. */
export const bookingCapabilities = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options">): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.bookingCapabilities() });

/** Read metadata through the existing OAuth refresh and credential-persistence boundary. */
export const readCommunications = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options"> & Readonly<{ resource: CommunicationResource; resourceId: string; options: CommunicationOptions }>): Promise<AgentResult> => {
  if (!validCommunicationResource(input.resource) || !validResourceId(input.resourceId) || !validCommunicationOptions(input.options)) throw new Error("Communication history options are invalid.");
  return invoke({ ...input, operation: (client) => client.communications(input.resource, input.resourceId, input.options) });
};

/** Read a bounded lifecycle page for one opaque service handle. */
export const readServiceHistory = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options"> & Readonly<{ resourceId: string; options: ServiceHistoryOptions }>): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId) || !validServiceHistoryOptions(input.options)) throw new Error("Service history options are invalid.");
  return invoke({ ...input, operation: (client) => client.serviceHistory(input.resourceId, input.options) });
};

/** Read bounded public payments linked to one opaque service handle. */
export const readServicePayments = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options"> & Readonly<{ resourceId: string; options: ServicePaymentOptions }>): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId) || !validServicePaymentOptions(input.options)) throw new Error("Service payment options are invalid.");
  return invoke({ ...input, operation: (client) => client.servicePayments(input.resourceId, input.options) });
};

/** Read canonical tax reports through the shared OAuth refresh and persistence boundary. */
export const readTaxReport = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options"> & Readonly<{ options: TaxReportOptions }>): Promise<AgentResult> => {
  if (!validTaxReportOptions(input.options)) throw new Error("Tax report options are invalid.");
  return invoke({ ...input, operation: (client) => client.taxReport(input.options) });
};

/** Read authorized margin groups without deriving costs, currencies or tenant periods in the client. */
export const readMarginReport = async (input: Omit<Parameters<typeof receivedPaymentSummary>[0], "options"> & Readonly<{ options: MarginReportOptions }>): Promise<AgentResult> => {
  if (!validMarginReportOptions(input.options)) throw new Error("Margin report options are invalid.");
  return invoke({ ...input, operation: (client) => client.marginReport(input.options) });
};

/** Lists at most 100 contract-defined customer records without accepting arbitrary paths or query keys. */
export const listCustomers = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  options: CustomerListOptions;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => {
  const options = boundedOptions(input.options);
  return invoke({ ...input, operation: (client) => client.list("customers", options) });
};

/** Reads one opaque customer identifier without allowing route fragments, URLs, or tenant identifiers. */
export const getCustomer = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
  resourceId: string;
  options?: ReadOptions;
}>): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Customer ID is invalid.");
  const options = boundedReadOptions(input.options ?? {});
  return invoke({ ...input, operation: (client) => client.get("customers", input.resourceId, options) });
};

/** Lists bounded canonical leads through the same OAuth refresh and persistence boundary as customers. */
export const listLeads = async (input: Parameters<typeof listCustomers>[0]): Promise<AgentResult> => {
  const options = boundedOptions(input.options);
  return invoke({ ...input, operation: (client) => client.list("leads", options) });
};

/** Reads a projected canonical lead without provider-specific routing or arbitrary query keys. */
export const getLead = async (input: Parameters<typeof getCustomer>[0]): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Lead ID is invalid.");
  const options = boundedReadOptions(input.options ?? {});
  return invoke({ ...input, operation: (client) => client.get("leads", input.resourceId, options) });
};

/** Discover canonical catalog facts with the shared OAuth refresh boundary. */
export const listCatalog = async (input: Parameters<typeof listCustomers>[0]): Promise<AgentResult> => {
  const options = boundedOptions(input.options);
  if (!validCatalogReadFields(options.fields ?? []) || !validSalesSearch(options.search ?? "")) throw new Error("Catalog read options are invalid.");
  return invoke({ ...input, operation: (client) => client.list("catalog", options) });
};

/** Read one opaque catalog handle without selecting a source. */
export const getCatalogItem = async (input: Parameters<typeof getCustomer>[0]): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Catalog ID is invalid.");
  const options = boundedReadOptions(input.options ?? {});
  if (!validCatalogReadFields(options.fields ?? [])) throw new Error("Catalog read options are invalid.");
  return invoke({ ...input, operation: (client) => client.get("catalog", input.resourceId, options) });
};

/** Discover quotes using the shared OAuth refresh boundary and canonical routing. */
export const listQuotes = async (input: Parameters<typeof listCustomers>[0]): Promise<AgentResult> => {
  const options = boundedOptions(input.options);
  if (!validQuoteReadFields(options.fields ?? [])) throw new Error("Quote fields are invalid.");
  if (!validSalesSearch(options.search ?? "")) throw new Error("Quote read options are invalid.");
  return invoke({ ...input, operation: (client) => client.list("quotes", options) });
};

/** Read public quote facts, including revision and opaque line handles for approved edits. */
export const getQuote = async (input: Parameters<typeof getCustomer>[0]): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Quote ID is invalid.");
  const options = boundedReadOptions(input.options ?? {});
  if (!validQuoteReadFields(options.fields ?? [])) throw new Error("Quote fields are invalid.");
  return invoke({ ...input, operation: (client) => client.get("quotes", input.resourceId, options) });
};

/** Discover services only through the canonical OAuth endpoint. */
export const listServices = async (input: Parameters<typeof listCustomers>[0]): Promise<AgentResult> => {
  const options = boundedOptions(input.options);
  if (!validServiceReadFields(options.fields ?? [], false)) throw new Error("Service fields are invalid.");
  if (!validSalesSearch(options.search ?? "")) throw new Error("Service read options are invalid.");
  return invoke({ ...input, operation: (client) => client.list("services", options) });
};

/** Read service detail, retaining opaque line handles and the concurrency revision. */
export const getService = async (input: Parameters<typeof getCustomer>[0]): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Service ID is invalid.");
  const options = boundedReadOptions(input.options ?? {});
  if (!validServiceReadFields(options.fields ?? [], true)) throw new Error("Service fields are invalid.");
  return invoke({ ...input, operation: (client) => client.get("services", input.resourceId, options) });
};

/** Read payment facts using the same refresh/persistence boundary and canonical API. */
export const listPayments = async (input: Omit<Parameters<typeof listCustomers>[0], "options"> & Readonly<{ options: PaymentListOptions }>): Promise<AgentResult> => {
  if (!validPaymentQuery(input.options)) throw new Error("Payment read options are invalid.");
  const options: ListOptions = { ...boundedOptions(input.options),
    ...(input.options.status === undefined ? {} : { status: input.options.status }),
    ...(input.options.date_field === undefined ? {} : { date_field: input.options.date_field }),
    ...(input.options.start === undefined ? {} : { start: input.options.start }),
    ...(input.options.end === undefined ? {} : { end: input.options.end }),
    ...(input.options.sort === undefined ? {} : { sort: input.options.sort }),
    ...(input.options.dir === undefined ? {} : { dir: input.options.dir }),
  };
  return invoke({ ...input, operation: (client) => client.list("payments", options) });
};

/** Read one opaque payment ID; never decode provider identity in the client. */
export const getPayment = async (input: Parameters<typeof getCustomer>[0]): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Payment ID is invalid.");
  const options = boundedReadOptions(input.options ?? {});
  if (!validPaymentQuery(options)) throw new Error("Payment read options are invalid.");
  return invoke({ ...input, operation: (client) => client.get("payments", input.resourceId, options) });
};

type WriteSession = Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>;

/** Read expenses through the shared OAuth refresh and persistence boundary. */
export const listExpenses = async (input: WriteSession & Readonly<{ options: ExpenseListOptions }>): Promise<AgentResult> => {
  if (!validExpenseListOptions(input.options)) throw new Error("Expense read options are invalid.");
  return invoke({ ...input, operation: (client) => client.list("expenses", input.options) });
};

/** Keep expense identity opaque; canonical API enforces live scope and role. */
export const getExpense = async (input: Parameters<typeof getCustomer>[0]): Promise<AgentResult> => {
  const options = input.options ?? {};
  if (!validResourceId(input.resourceId) || !validExpenseListOptions(options)
    || Object.keys(options).some((key) => key !== "fields")) throw new Error("Expense read options are invalid.");
  return invoke({ ...input, operation: (client) => client.get("expenses", input.resourceId, options) });
};

/** Read recurring expense schedules without creating or materializing expenses. */
export const listExpenseSchedules = async (input: WriteSession & Readonly<{ options: ExpenseScheduleListOptions }>): Promise<AgentResult> => {
  if (!validExpenseScheduleListOptions(input.options)) throw new Error("Expense schedule read options are invalid.");
  return invoke({ ...input, operation: (client) => client.list("expense-schedules", input.options) });
};

/** Keep a schedule handle opaque and distinct from an individual expense ID. */
export const getExpenseSchedule = async (input: WriteSession & Readonly<{ resourceId: string; options?: Pick<ExpenseScheduleListOptions, "fields"> }>): Promise<AgentResult> => {
  const options = input.options ?? {};
  if (!validResourceId(input.resourceId) || !validExpenseScheduleGetOptions(options)) throw new Error("Expense schedule read options are invalid.");
  return invoke({ ...input, operation: (client) => client.get("expense-schedules", input.resourceId, options) });
};

/** Refresh before preview; canonical server owns validation, routing and approval policy. */
export const previewCustomerUpdate = (input: WriteSession & Readonly<{ proposal: CustomerUpdatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewCustomerUpdate(input.proposal) });

/** Preserve caller-owned idempotency identity and never automatically replay a mutation POST. */
export const executeCustomerUpdate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeCustomerUpdate(input.approval) });

/** Read the original execution outcome; no receipt, mutation or claim recovery is performed. */
export const customerUpdateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.customerUpdateStatus(input.query) });

/** Prepare an opt-in canonical lead update without replaying mutation requests. */
export const previewLeadUpdate = (input: WriteSession & Readonly<{ proposal: CustomerUpdatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewLeadUpdate(input.proposal) });

/** Execute the exact human receipt and original idempotency key; never auto-replay POST. */
export const executeLeadUpdate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeLeadUpdate(input.approval) });

/** Recover the original lead execution outcome without changing it. */
export const leadUpdateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.leadUpdateStatus(input.query) });

/** Preview one draft quote without replaying the mutation POST. */
export const previewQuoteCreate = (input: WriteSession & Readonly<{ proposal: QuoteCreatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewQuoteCreate(input.proposal) });

/** Execute the approved quote draft once; uncertain outcomes require status reconciliation. */
export const executeQuoteCreate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeQuoteCreate(input.approval) });

/** Read the original quote-create outcome without repeating the mutation. */
export const quoteCreateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.quoteCreateStatus(input.query) });

/** Preview a revision to one draft quote without repeating a business write. */
export const previewQuoteUpdate = (input: WriteSession & Readonly<{ proposal: QuoteUpdatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewQuoteUpdate(input.proposal) });

/** Execute one approved quote revision; reconcile uncertain outcomes by status. */
export const executeQuoteUpdate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeQuoteUpdate(input.approval) });

/** Read the original quote-update outcome without repeating the mutation. */
export const quoteUpdateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.quoteUpdateStatus(input.query) });

/** Preview one irreversible quote-to-service transition without executing it. */
export const previewQuoteAccept = (input: WriteSession & Readonly<{ proposal: Readonly<{ resource_id: string }> }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewQuoteAccept(input.proposal) });

/** Execute only the exact dashboard-approved acceptance; never replay the POST. */
export const executeQuoteAccept = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeQuoteAccept(input.approval) });

/** Reconcile an uncertain acceptance without repeating the lifecycle action. */
export const quoteAcceptStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.quoteAcceptStatus(input.query) });

/** Preview a quote decline without changing its lifecycle state. */
export const previewQuoteDecline = (input: WriteSession & Readonly<{ proposal: Readonly<{ resource_id: string }> }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewQuoteDecline(input.proposal) });

/** Execute only one dashboard-approved decline; never replay the POST. */
export const executeQuoteDecline = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeQuoteDecline(input.approval) });

/** Read a prior quote-decline outcome without repeating the lifecycle action. */
export const quoteDeclineStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.quoteDeclineStatus(input.query) });

/** Preview canonical service creation without creating a service or sending mail. */
export const previewServiceCreate = (input: WriteSession & Readonly<{ proposal: ServiceCreatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewServiceCreate(input.proposal) });

/** Execute one dashboard-approved service creation without automatic POST replay. */
export const executeServiceCreate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeServiceCreate(input.approval) });

/** Reconcile service creation through the original read-only status endpoint. */
export const serviceCreateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.serviceCreateStatus(input.query) });

/** Preview a version-bound canonical service update without applying changes or notifications. */
export const previewServiceUpdate = (input: WriteSession & Readonly<{ proposal: ServiceUpdatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewServiceUpdate(input.proposal) });

/** Execute one approved update without replaying a potentially externally visible effect. */
export const executeServiceUpdate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeServiceUpdate(input.approval) });

/** Reconcile the stored update outcome without repeating the mutation. */
export const serviceUpdateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.serviceUpdateStatus(input.query) });

/** Preview a non-delivery service lifecycle transition without applying effects. */
export const previewServiceTransition = (input: WriteSession & Readonly<{ proposal: ServiceTransitionPreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewServiceTransition(input.proposal) });

/** Execute only a dashboard-approved transition; never replay the mutation POST. */
export const executeServiceTransition = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeServiceTransition(input.approval) });

/** Reconcile a stored transition outcome without repeating its lifecycle effects. */
export const serviceTransitionStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.serviceTransitionStatus(input.query) });

/** Preview one canonical service delivery without changing state or notifying customers. */
export const previewServiceDelivery = (input: WriteSession & Readonly<{ proposal: Readonly<{ resource_id: string }> }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewServiceDelivery(input.proposal) });

/** Execute only the exact approved delivery and never replay its mutation POST. */
export const executeServiceDelivery = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeServiceDelivery(input.approval) });

/** Reconcile delivery through the stored read-only status endpoint. */
export const serviceDeliveryStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.serviceDeliveryStatus(input.query) });
