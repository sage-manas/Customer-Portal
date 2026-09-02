-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SapDriver" AS ENUM ('mock', 'ecc', 's4');

-- CreateEnum
CREATE TYPE "GstnDriver" AS ENUM ('mock', 'api');

-- CreateEnum
CREATE TYPE "PaymentGatewayDriver" AS ENUM ('mock', 'razorpay');

-- CreateEnum
CREATE TYPE "CredentialSystem" AS ENUM ('sap', 'gstn', 'payment_gateway');

-- CreateEnum
CREATE TYPE "PaymentState" AS ENUM ('initiated', 'captured', 'posted', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'sap_manager', 'client_admin', 'ap_manager', 'ar_manager', 'customer');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('draft', 'submitted', 'pending_approval', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PodOutcome" AS ENUM ('confirmed', 'discrepancy');

-- CreateEnum
CREATE TYPE "OutboxState" AS ENUM ('pending', 'publishing', 'published', 'failed');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('delivery', 'quality', 'billing', 'product', 'general');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketRelatedDocType" AS ENUM ('order', 'delivery', 'invoice');

-- CreateEnum
CREATE TYPE "LoyaltyTierName" AS ENUM ('bronze', 'silver', 'gold', 'platinum');

-- CreateEnum
CREATE TYPE "CreditRequestState" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('info', 'success', 'warning', 'critical');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customDomain" TEXT,
    "sapDriver" "SapDriver" NOT NULL DEFAULT 'mock',
    "gstnDriver" "GstnDriver" NOT NULL DEFAULT 'mock',
    "paymentGateway" "PaymentGatewayDriver" NOT NULL DEFAULT 'mock',
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "moduleToggles" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roles" "UserRole"[],
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_account_links" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sapKunnr" TEXT NOT NULL,

    CONSTRAINT "user_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sapKunnr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedByUserId" TEXT,
    "deactivationReason" TEXT,
    "registeredByUserId" TEXT,
    "onboardingApplicationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_applications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'draft',
    "data" JSONB NOT NULL,
    "draftToken" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "contactEmail" TEXT,
    "gstin" TEXT,
    "gstinVerification" JSONB,
    "salesOrg" TEXT,
    "distributionChannel" TEXT,
    "creditApprovalStatus" TEXT,
    "sapCustomerCode" TEXT,
    "rejectionReasons" TEXT[],
    "reviewNote" TEXT,
    "decidedByUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "status" "OnboardingStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "soNumber" TEXT,
    "orderStatus" TEXT NOT NULL,
    "creditStatus" TEXT NOT NULL,
    "header" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "uom" TEXT NOT NULL,
    "price" DECIMAL(65,30),
    "plant" TEXT,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "inquiryNumber" TEXT,
    "header" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_draft_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "material" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "uom" TEXT NOT NULL,

    CONSTRAINT "inquiry_draft_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_confirmations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "deliveryVbeln" TEXT NOT NULL,
    "salesOrder" TEXT NOT NULL,
    "outcome" "PodOutcome" NOT NULL,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "signedPodKey" TEXT,
    "confirmedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pod_confirmation_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "confirmationId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "material" TEXT NOT NULL,
    "dispatchedQty" DECIMAL(65,30) NOT NULL,
    "receivedQty" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "pod_confirmation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "mode" TEXT NOT NULL,
    "state" "PaymentState" NOT NULL DEFAULT 'initiated',
    "gatewayReference" TEXT,
    "fiDocumentNumber" TEXT,
    "failureReason" TEXT,
    "lastEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "cleared" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "queue" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "state" "OutboxState" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "raisedByUserId" TEXT,
    "category" "TicketCategory" NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "relatedDocType" "TicketRelatedDocType",
    "relatedDocNumber" TEXT,
    "assigneeUserId" TEXT,
    "resolution" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "ratingComment" TEXT,
    "slaBreachedAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorIsAgent" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "commentId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_tier_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tier" "LoyaltyTierName" NOT NULL,
    "thresholdAmount" DECIMAL(65,30) NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_tier_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_limit_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerKunnr" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedLimit" DECIMAL(65,30) NOT NULL,
    "currentLimit" DECIMAL(65,30) NOT NULL,
    "justification" TEXT NOT NULL,
    "state" "CreditRequestState" NOT NULL DEFAULT 'pending',
    "approvedLimit" DECIMAL(65,30),
    "decisionNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_limit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_counters" (
    "tenantId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_counters_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerKunnr" TEXT,
    "eventName" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "UserRole"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_data_keys" (
    "tenantId" TEXT NOT NULL,
    "wrappedKey" TEXT NOT NULL,
    "wrapIv" TEXT NOT NULL,
    "wrapAuthTag" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_data_keys_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "tenant_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "system" "CredentialSystem" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sap_config_audit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "operatorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromDriver" "SapDriver",
    "toDriver" "SapDriver",
    "changedFields" TEXT[],
    "result" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sap_config_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_customDomain_key" ON "tenants"("customDomain");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "user_account_links_tenantId_idx" ON "user_account_links"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "user_account_links_tenantId_userId_sapKunnr_key" ON "user_account_links"("tenantId", "userId", "sapKunnr");

-- CreateIndex
CREATE INDEX "customer_accounts_tenantId_idx" ON "customer_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_tenantId_sapKunnr_key" ON "customer_accounts"("tenantId", "sapKunnr");

-- CreateIndex
CREATE INDEX "onboarding_applications_tenantId_idx" ON "onboarding_applications"("tenantId");

-- CreateIndex
CREATE INDEX "onboarding_applications_tenantId_status_idx" ON "onboarding_applications"("tenantId", "status");

-- CreateIndex
CREATE INDEX "onboarding_applications_tenantId_gstin_idx" ON "onboarding_applications"("tenantId", "gstin");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_applications_tenantId_draftToken_key" ON "onboarding_applications"("tenantId", "draftToken");

-- CreateIndex
CREATE INDEX "onboarding_documents_tenantId_idx" ON "onboarding_documents"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_documents_tenantId_applicationId_kind_key" ON "onboarding_documents"("tenantId", "applicationId", "kind");

-- CreateIndex
CREATE INDEX "onboarding_events_tenantId_idx" ON "onboarding_events"("tenantId");

-- CreateIndex
CREATE INDEX "onboarding_events_tenantId_applicationId_idx" ON "onboarding_events"("tenantId", "applicationId");

-- CreateIndex
CREATE INDEX "carts_tenantId_idx" ON "carts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_tenantId_customerKunnr_key" ON "carts"("tenantId", "customerKunnr");

-- CreateIndex
CREATE INDEX "cart_lines_tenantId_idx" ON "cart_lines"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_lines_tenantId_cartId_material_key" ON "cart_lines"("tenantId", "cartId", "material");

-- CreateIndex
CREATE INDEX "sales_orders_tenantId_idx" ON "sales_orders"("tenantId");

-- CreateIndex
CREATE INDEX "sales_orders_tenantId_customerKunnr_orderStatus_idx" ON "sales_orders"("tenantId", "customerKunnr", "orderStatus");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_tenantId_soNumber_key" ON "sales_orders"("tenantId", "soNumber");

-- CreateIndex
CREATE INDEX "sales_order_lines_tenantId_idx" ON "sales_order_lines"("tenantId");

-- CreateIndex
CREATE INDEX "inquiry_drafts_tenantId_idx" ON "inquiry_drafts"("tenantId");

-- CreateIndex
CREATE INDEX "inquiry_drafts_tenantId_customerKunnr_idx" ON "inquiry_drafts"("tenantId", "customerKunnr");

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_drafts_tenantId_inquiryNumber_key" ON "inquiry_drafts"("tenantId", "inquiryNumber");

-- CreateIndex
CREATE INDEX "inquiry_draft_lines_tenantId_idx" ON "inquiry_draft_lines"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_draft_lines_tenantId_draftId_lineNo_key" ON "inquiry_draft_lines"("tenantId", "draftId", "lineNo");

-- CreateIndex
CREATE INDEX "pod_confirmations_tenantId_idx" ON "pod_confirmations"("tenantId");

-- CreateIndex
CREATE INDEX "pod_confirmations_tenantId_customerKunnr_outcome_idx" ON "pod_confirmations"("tenantId", "customerKunnr", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "pod_confirmations_tenantId_deliveryVbeln_key" ON "pod_confirmations"("tenantId", "deliveryVbeln");

-- CreateIndex
CREATE INDEX "pod_confirmation_lines_tenantId_idx" ON "pod_confirmation_lines"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pod_confirmation_lines_tenantId_confirmationId_lineNo_key" ON "pod_confirmation_lines"("tenantId", "confirmationId", "lineNo");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE INDEX "payments_tenantId_customerKunnr_state_idx" ON "payments"("tenantId", "customerKunnr", "state");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_gatewayReference_key" ON "payments"("tenantId", "gatewayReference");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_lastEventId_key" ON "payments"("tenantId", "lastEventId");

-- CreateIndex
CREATE INDEX "payment_allocations_tenantId_idx" ON "payment_allocations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_tenantId_paymentId_documentNumber_key" ON "payment_allocations"("tenantId", "paymentId", "documentNumber");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_state_occurredAt_idx" ON "outbox_events"("tenantId", "state", "occurredAt");

-- CreateIndex
CREATE INDEX "outbox_events_tenantId_idx" ON "outbox_events"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenantId_dedupeKey_key" ON "outbox_events"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_log_tenantId_idx" ON "audit_log"("tenantId");

-- CreateIndex
CREATE INDEX "support_tickets_tenantId_idx" ON "support_tickets"("tenantId");

-- CreateIndex
CREATE INDEX "support_tickets_tenantId_customerKunnr_status_idx" ON "support_tickets"("tenantId", "customerKunnr", "status");

-- CreateIndex
CREATE INDEX "support_tickets_tenantId_status_priority_openedAt_idx" ON "support_tickets"("tenantId", "status", "priority", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_tenantId_ticketNo_key" ON "support_tickets"("tenantId", "ticketNo");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_tenantId_sourceKey_key" ON "support_tickets"("tenantId", "sourceKey");

-- CreateIndex
CREATE INDEX "ticket_comments_tenantId_idx" ON "ticket_comments"("tenantId");

-- CreateIndex
CREATE INDEX "ticket_comments_tenantId_ticketId_createdAt_idx" ON "ticket_comments"("tenantId", "ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_attachments_tenantId_idx" ON "ticket_attachments"("tenantId");

-- CreateIndex
CREATE INDEX "ticket_attachments_tenantId_ticketId_idx" ON "ticket_attachments"("tenantId", "ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_attachments_tenantId_storageKey_key" ON "ticket_attachments"("tenantId", "storageKey");

-- CreateIndex
CREATE INDEX "loyalty_tier_settings_tenantId_idx" ON "loyalty_tier_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_tier_settings_tenantId_tier_key" ON "loyalty_tier_settings"("tenantId", "tier");

-- CreateIndex
CREATE INDEX "credit_limit_requests_tenantId_idx" ON "credit_limit_requests"("tenantId");

-- CreateIndex
CREATE INDEX "credit_limit_requests_tenantId_customerKunnr_state_idx" ON "credit_limit_requests"("tenantId", "customerKunnr", "state");

-- CreateIndex
CREATE INDEX "credit_limit_requests_tenantId_state_createdAt_idx" ON "credit_limit_requests"("tenantId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_occurredAt_idx" ON "notifications"("tenantId", "userId", "occurredAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_readAt_idx" ON "notifications"("tenantId", "userId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_userId_eventId_templateKey_key" ON "notifications"("tenantId", "userId", "eventId", "templateKey");

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");

-- CreateIndex
CREATE INDEX "tenant_credentials_tenantId_idx" ON "tenant_credentials"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_credentials_tenantId_system_key" ON "tenant_credentials"("tenantId", "system");

-- CreateIndex
CREATE INDEX "sap_config_audit_tenantId_createdAt_idx" ON "sap_config_audit"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_account_links" ADD CONSTRAINT "user_account_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_applications" ADD CONSTRAINT "onboarding_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "onboarding_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_events" ADD CONSTRAINT "onboarding_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "onboarding_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_lines" ADD CONSTRAINT "cart_lines_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_drafts" ADD CONSTRAINT "inquiry_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_draft_lines" ADD CONSTRAINT "inquiry_draft_lines_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "inquiry_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_confirmations" ADD CONSTRAINT "pod_confirmations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_confirmation_lines" ADD CONSTRAINT "pod_confirmation_lines_confirmationId_fkey" FOREIGN KEY ("confirmationId") REFERENCES "pod_confirmations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comments" ADD CONSTRAINT "ticket_comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ticket_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_tier_settings" ADD CONSTRAINT "loyalty_tier_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_limit_requests" ADD CONSTRAINT "credit_limit_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_counters" ADD CONSTRAINT "ticket_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_data_keys" ADD CONSTRAINT "tenant_data_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_credentials" ADD CONSTRAINT "tenant_credentials_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sap_config_audit" ADD CONSTRAINT "sap_config_audit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

