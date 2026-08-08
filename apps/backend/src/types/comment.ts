import type { Role } from "db/Role";

type comment = {
    id: string;
    description: string;
    parentId: string | null;
    createdAt: Date;
    issue: {
        id: string;
        title: string;
        board: {
            org: {
                members: {
                    id: string;
                    userId: string;
                    orgId: string;
                    accepted: boolean;
                    role: Role
                }[];
            };
        };
    };
    user: {
        username: string;
    };
};

type SingleCommentWithoutBoard = Omit<comment, 'issue'> & {
  issue: Omit<comment['issue'], 'board'>;
};


export type CommentsWithoutBoard = SingleCommentWithoutBoard[];