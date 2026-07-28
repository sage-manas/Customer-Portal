import type {
  CanonicalCustomer,
  ConfirmPodInput,
  ConfirmPodResult,
  CreateSalesOrderInput,
  CreditInfo,
  CustomerCreateResult,
  CustomerPrice,
  Delivery,
  IncomingPaymentInput,
  IncomingPaymentResult,
  Invoice,
  Material,
  MaterialQuery,
  OpenItem,
  OrderSimulation,
  OrderStatusView,
  Page,
  SalesOrderResult,
  ShipToAddress,
  StockLevel,
} from "@cc/domain";

import type { SapAdapter, SapConnectionHealth, SapDriverName, SapRead } from "../contract";
import { sapNotImplemented } from "../errors";

/**
 * Shared skeleton for the real drivers.
 *
 * Every method throws a typed `not_implemented` SapError, so a tenant
 * mis-configured onto `ecc`/`s4` before Phase 7 fails loudly at the call
 * site with a translatable error — rather than the factory silently
 * handing back the mock and serving fabricated data as if it were the
 * tenant's real SAP (docs/06 Phase 7: "real adapter stubs (ecc/s4
 * skeletons)").
 *
 * Subclasses override methods one at a time as the connectivity work lands;
 * the contract test-suite runs against them unchanged.
 */
export abstract class NotImplementedSapAdapter implements SapAdapter {
  abstract readonly driver: SapDriverName;

  protected fail(operation: string): never {
    throw sapNotImplemented(this.driver, operation);
  }

  async health(): Promise<SapConnectionHealth> {
    return {
      reachable: false,
      driver: this.driver,
      circuit: "open",
      checkedAt: new Date().toISOString(),
    };
  }

  async createCustomer(_customer: CanonicalCustomer): Promise<CustomerCreateResult> {
    this.fail("createCustomer");
  }
  async getCustomer(_kunnr: string): Promise<SapRead<CanonicalCustomer>> {
    this.fail("getCustomer");
  }
  async getShipToAddresses(_kunnr: string): Promise<SapRead<ShipToAddress[]>> {
    this.fail("getShipToAddresses");
  }
  async getCreditInfo(_kunnr: string): Promise<SapRead<CreditInfo>> {
    this.fail("getCreditInfo");
  }
  async getMaterials(_query?: MaterialQuery): Promise<SapRead<Page<Material>>> {
    this.fail("getMaterials");
  }
  async getMaterial(_material: string): Promise<SapRead<Material>> {
    this.fail("getMaterial");
  }
  async getStock(_material: string, _plant?: string): Promise<SapRead<StockLevel[]>> {
    this.fail("getStock");
  }
  async getCustomerPrice(
    _kunnr: string,
    _material: string,
    _quantity: number,
  ): Promise<SapRead<CustomerPrice>> {
    this.fail("getCustomerPrice");
  }
  async simulateOrder(_input: CreateSalesOrderInput): Promise<OrderSimulation> {
    this.fail("simulateOrder");
  }
  async createSalesOrder(_input: CreateSalesOrderInput): Promise<SalesOrderResult> {
    this.fail("createSalesOrder");
  }
  async cancelSalesOrder(_vbeln: string, _reason?: string): Promise<SalesOrderResult> {
    this.fail("cancelSalesOrder");
  }
  async getOrderStatus(_vbeln: string): Promise<SapRead<OrderStatusView>> {
    this.fail("getOrderStatus");
  }
  async getOrders(_kunnr: string): Promise<SapRead<Page<OrderStatusView>>> {
    this.fail("getOrders");
  }
  async getDeliveries(_kunnr: string): Promise<SapRead<Page<Delivery>>> {
    this.fail("getDeliveries");
  }
  async getDeliveriesForOrder(_vbeln: string): Promise<SapRead<Delivery[]>> {
    this.fail("getDeliveriesForOrder");
  }
  async getDelivery(_deliveryVbeln: string): Promise<SapRead<Delivery>> {
    this.fail("getDelivery");
  }
  async confirmPod(_input: ConfirmPodInput): Promise<ConfirmPodResult> {
    this.fail("confirmPod");
  }
  async getInvoices(_kunnr: string): Promise<SapRead<Page<Invoice>>> {
    this.fail("getInvoices");
  }
  async getInvoice(_vbeln: string): Promise<SapRead<Invoice>> {
    this.fail("getInvoice");
  }
  async getInvoicePdf(_vbeln: string): Promise<string> {
    this.fail("getInvoicePdf");
  }
  async getOpenItems(_kunnr: string): Promise<SapRead<OpenItem[]>> {
    this.fail("getOpenItems");
  }
  async postIncomingPayment(_input: IncomingPaymentInput): Promise<IncomingPaymentResult> {
    this.fail("postIncomingPayment");
  }
}
