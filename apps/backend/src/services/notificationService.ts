import { prisma } from "db/prisma";

export interface CreateNotificationParams
{
    recipientId: string;
    type: string;
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
    return client.notifications.create({
        data: {
            recipientId: params.recipientId,
            type: params.type,
            data: params.data as any,
            read: false
        }
    });
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

    if (typeof client.notifications.createManyAndReturn === "function")
    {
        return client.notifications.createManyAndReturn({
            data: items.map(item => ({
                recipientId: item.recipientId,
                type: item.type,
                data: item.data as any,
                read: false
            }))
        });
    }

    return Promise.all(items.map(item => createNotification(item, client)));
}
