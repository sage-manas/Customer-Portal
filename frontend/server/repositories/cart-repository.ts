import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Cart persistence.
 *
 * The table holds material and quantity and nothing else — no description, no
 * UOM, no price, no stock. All of that is a per-customer SAP read that goes
 * stale, so it is fetched on every load and the cart survives a SAP outage
 * unpriced rather than showing a price the order would not honour (ADR-014).
 *
 * Keyed per sold-to account rather than per user: colleagues on the same KUNNR
 * build one basket.
 */

export function findCart(tenantId: string, customerKunnr: string) {
  return prisma.cart.findUnique({
    where: { tenantId_customerKunnr: { tenantId, customerKunnr } },
    include: { lines: { orderBy: { addedAt: "asc" } } },
  });
}

export async function ensureCart(tenantId: string, customerKunnr: string) {
  return prisma.cart.upsert({
    where: { tenantId_customerKunnr: { tenantId, customerKunnr } },
    create: { tenantId, customerKunnr },
    update: {},
    include: { lines: { orderBy: { addedAt: "asc" } } },
  });
}

export function countLines(tenantId: string, customerKunnr: string) {
  return prisma.cartLine.count({ where: { tenantId, cart: { customerKunnr, tenantId } } });
}

/**
 * Adds a material, or increases the quantity if it is already there.
 *
 * The unique constraint on (tenantId, cartId, material) is what makes this
 * idempotent — two concurrent adds of the same material become one line with
 * the summed quantity rather than two lines racing.
 */
export async function upsertLine(
  tenantId: string,
  cartId: string,
  material: string,
  quantity: number,
) {
  return prisma.cartLine.upsert({
    where: { tenantId_cartId_material: { tenantId, cartId, material } },
    create: { tenantId, cartId, material, quantity },
    update: { quantity: { increment: quantity } },
  });
}

export function findLine(tenantId: string, cartId: string, lineId: string) {
  return prisma.cartLine.findFirst({ where: { id: lineId, tenantId, cartId } });
}

export function setLineQuantity(lineId: string, quantity: number) {
  return prisma.cartLine.update({ where: { id: lineId }, data: { quantity } });
}

export function deleteLine(lineId: string) {
  return prisma.cartLine.delete({ where: { id: lineId } });
}

export function clearLines(tenantId: string, cartId: string) {
  return prisma.cartLine.deleteMany({ where: { tenantId, cartId } });
}

export function touchCart(cartId: string) {
  return prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
}
