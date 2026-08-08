import type { CommentsWithoutBoard } from "../types/comment"

type CommentNode = CommentsWithoutBoard[number] & {
    children: CommentNode[];
};

export function buildCommentTree(flatComments: CommentsWithoutBoard): CommentNode[]
{
    const commentMap = new Map<string, CommentNode>();
    const roots: CommentNode[] = [];

    // Step 1: Initialize all nodes with an empty children array
    flatComments.forEach((comment) =>
    {
        commentMap.set(comment.id, { ...comment, children: [] });
    });

    // Step 2: Link children to their parent or push to roots
    flatComments.forEach((comment) =>
    {
        const node = commentMap.get(comment.id)!;
        if (comment.parentId && commentMap.has(comment.parentId))
        {
            commentMap.get(comment.parentId)!.children.push(node);
        } else
        {
            roots.push(node);
        }
    });

    return roots;
}
