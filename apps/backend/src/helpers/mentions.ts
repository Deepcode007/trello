import { prisma } from "db/prisma";

export interface ParsedMention
{
    displayName: string;
    userId: string;
}

export interface ValidatedMention
{
    userId: string;
    displayName: string;
    username?: string;
}

/**
 * Regex for parsing mention markup: @[DisplayName](user:userId)
 */
const MENTION_REGEX = /@\[([^\]]+)\]\(user:([a-zA-Z0-9_-]+)\)/g;

/**
 * Parses mention markup from text and returns deduplicated parsed mentions.
 * Format: @[DisplayName](user:userId)
 *
 * @param text The string containing potential mention markup
 * @returns Array of unique ParsedMention objects
 */
export function parseMentions(text: string): ParsedMention[]
{
    if (!text || typeof text !== "string")
    {
        return [];
    }

    const mentions: ParsedMention[] = [];
    const seenUserIds = new Set<string>();

    let match: RegExpExecArray | null;
    // Reset lastIndex in case regex is reused
    const regex = new RegExp(MENTION_REGEX.source, "g");

    while ((match = regex.exec(text)) !== null)
    {
        const displayName = match[1]?.trim();
        const userId = match[2]?.trim();

        if (displayName && userId && !seenUserIds.has(userId))
        {
            seenUserIds.add(userId);
            mentions.push({ displayName, userId });
        }
    }

    return mentions;
}

/**
 * Validates mentions against organization membership.
 * Filters out:
 * - Self-mentions (userId === authorId)
 * - Users that do not exist
 * - Users not in the specified organization
 * - Users with pending (unaccepted) organization memberships
 *
 * @param mentions Array of ParsedMention objects or user ID strings
 * @param orgId The organization ID owning the board/comment
 * @param authorId The ID of the user authoring the text
 * @param tx Optional Prisma transaction or client
 * @returns Array of ValidatedMention objects
 */
export async function validateMentions(
    mentions: Array<ParsedMention | string>,
    orgId: string,
    authorId: string,
    tx?: any
): Promise<ValidatedMention[]>
{
    if (!mentions || !Array.isArray(mentions) || mentions.length === 0 || !orgId)
    {
        return [];
    }

    // Normalize mentions to objects with displayName and userId
    const normalized: ParsedMention[] = [];
    const seenUserIds = new Set<string>();

    for (const item of mentions)
    {
        const userId = typeof item === "string" ? item.trim() : item.userId?.trim();
        const displayName = typeof item === "string" ? "" : item.displayName?.trim() ?? "";

        if (userId && !seenUserIds.has(userId))
        {
            seenUserIds.add(userId);
            // Filter out self-mentions immediately
            if (userId !== authorId)
            {
                normalized.push({ userId, displayName });
            }
        }
    }

    if (normalized.length === 0)
    {
        return [];
    }

    const candidateUserIds = normalized.map(m => m.userId);
    const client = tx ?? prisma;

    const validMemberships = await client.membership.findMany({
        where: {
            orgId,
            userId: { in: candidateUserIds },
            accepted: true
        },
        select: {
            userId: true,
            user: {
                select: {
                    id: true,
                    username: true,
                    name: true
                }
            }
        }
    });

    const membershipMap = new Map<string, { username: string; name: string | null }>();
    for (const m of validMemberships)
    {
        if (m.userId && m.user)
        {
            membershipMap.set(m.userId, {
                username: m.user.username,
                name: m.user.name
            });
        }
    }

    const validated: ValidatedMention[] = [];
    for (const item of normalized)
    {
        const memberInfo = membershipMap.get(item.userId);
        if (memberInfo)
        {
            validated.push({
                userId: item.userId,
                displayName: item.displayName || memberInfo.name || memberInfo.username,
                username: memberInfo.username
            });
        }
    }

    return validated;
}
