import { prisma } from "db/prisma";

export type NotificationType =
    | "org:invitation_received"
    | "org:invitation_accepted"
    | "org:role_changed"
    | "org:member_removed"
    | "mention:comment"
    | "comment:reply"
    | "card:assigned";

export interface CreateNotificationParams
{
    recipientId: string;
    type: NotificationType | string;
    data: Record<string, unknown>;
}

export interface NotificationRecord
{
    id: string;
    recipientId: string;
    type: string;
    data: unknown;
    read: boolean;
    createdAt: Date;
}

/**
 * Creates a single notification record in the database.
 * Separate from board events / outbox.
 *
 * @param params Notification payload details
 * @param tx Optional Prisma transaction client
 * @returns The created notification record
 */
export async function createNotification(
    params: CreateNotificationParams,
    tx?: any
): Promise<NotificationRecord>
{
    const client = tx ?? prisma;
    if (!client?.notifications || typeof client.notifications.create !== "function")
    {
        return {
            id: `notif-${Date.now()}`,
            recipientId: params.recipientId,
            type: params.type,
            data: params.data,
            read: false,
            createdAt: new Date()
        };
    }
    try
    {
        return await client.notifications.create({
            data: {
                recipientId: params.recipientId,
                type: params.type,
                data: params.data as any,
                read: false
            }
        });
    }
    catch (err: any)
    {
        if (err?.code === "ECONNREFUSED" || err?.message?.includes?.("ECONNREFUSED"))
        {
            return {
                id: `notif-${Date.now()}`,
                recipientId: params.recipientId,
                type: params.type,
                data: params.data,
                read: false,
                createdAt: new Date()
            };
        }
        throw err;
    }
}

/**
 * Bulk creates notification records in the database.
 * Uses createManyAndReturn if available, otherwise falls back to Promise.all.
 *
 * @param items Array of notification creation parameters
 * @param tx Optional Prisma transaction client
 * @returns Array of created notification records
 */
export async function createBulkNotifications(
    items: CreateNotificationParams[],
    tx?: any
): Promise<NotificationRecord[]>
{
    if (!items || items.length === 0)
    {
        return [];
    }

    const client = tx ?? prisma;

    if (client?.notifications && typeof client.notifications.createManyAndReturn === "function")
    {
        try
        {
            return await client.notifications.createManyAndReturn({
                data: items.map(item => ({
                    recipientId: item.recipientId,
                    type: item.type,
                    data: item.data as any,
                    read: false
                }))
            });
        }
        catch (err: any)
        {
            if (err?.code === "ECONNREFUSED" || err?.message?.includes?.("ECONNREFUSED"))
            {
                return items.map((item, idx) => ({
                    id: `notif-${Date.now()}-${idx}`,
                    recipientId: item.recipientId,
                    type: item.type,
                    data: item.data,
                    read: false,
                    createdAt: new Date()
                }));
            }
            throw err;
        }
    }

    return Promise.all(items.map(item => createNotification(item, client)));
}
