import React, { useState, useEffect, useRef, useCallback } from "react";
import { Textarea } from "../../ui/textarea";
import { Avatar } from "../../ui/avatar";
import { orgApi, type SearchMemberResult } from "../../../lib/org-api";
import { cn } from "../../../lib/utils";
import { Loader2 } from "lucide-react";

export interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  orgId?: string;
  members?: SearchMemberResult[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  rows?: number;
  "data-testid"?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function MentionInput({
  value,
  onChange,
  orgId,
  members: propMembers,
  placeholder,
  disabled,
  className,
  autoFocus,
  rows,
  "data-testid": testId,
  onKeyDown
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [cursorPos, setCursorPos] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [loadedMembers, setLoadedMembers] = useState<SearchMemberResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Check for mention trigger (@) right before current cursor position
  const checkMentionTrigger = useCallback((text: string, selectionStart: number) => {
    const textBefore = text.slice(0, selectionStart);
    // Matches @query at start of text or following whitespace
    const match = /(?:^|\s)@([a-zA-Z0-9_.-]*)$/.exec(textBefore);

    if (match) {
      const query = match[1] ?? "";
      const atPos = textBefore.lastIndexOf("@");
      setMentionStartIndex(atPos);
      setCursorPos(selectionStart);
      setSearchQuery(query);
      setSelectedIndex(0);
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setMentionStartIndex(-1);
    }
  }, []);

  // Fetch or filter members whenever dropdown is open and query/orgId changes
  useEffect(() => {
    if (!isOpen) return;

    if (propMembers && propMembers.length > 0) {
      const q = searchQuery.toLowerCase();
      const filtered = propMembers.filter(
        m =>
          m.username.toLowerCase().includes(q) ||
          (m.name && m.name.toLowerCase().includes(q))
      );
      setLoadedMembers(filtered);
      return;
    }

    if (!orgId) {
      setLoadedMembers([]);
      return;
    }

    let isSubscribed = true;
    setIsLoading(true);

    orgApi
      .searchMembers(orgId, searchQuery, 10)
      .then(results => {
        if (isSubscribed) {
          setLoadedMembers(results);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isSubscribed) {
          setLoadedMembers([]);
          setIsLoading(false);
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, searchQuery, orgId, propMembers]);

  // Handle selecting a member to insert mention markup
  const selectMember = useCallback(
    (member: SearchMemberResult) => {
      if (mentionStartIndex < 0) return;

      const displayName = member.name || member.username;
      const mentionMarkup = `@[${displayName}](user:${member.id}) `;

      const before = value.slice(0, mentionStartIndex);
      const after = value.slice(cursorPos);
      const newValue = `${before}${mentionMarkup}${after}`;

      onChange(newValue);
      setIsOpen(false);
      setMentionStartIndex(-1);

      const nextCursor = before.length + mentionMarkup.length;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextCursor, nextCursor);
        }
      }, 0);
    },
    [cursorPos, mentionStartIndex, onChange, value]
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart;
    onChange(val);
    checkMentionTrigger(val, pos);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Only check cursor movement navigation keys if not handling dropdown
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      const pos = e.currentTarget.selectionStart;
      checkMentionTrigger(value, pos);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isOpen && loadedMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % loadedMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + loadedMembers.length) % loadedMembers.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = loadedMembers[selectedIndex];
        if (selected) {
          selectMember(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        return;
      }
    } else if (isOpen && e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      return;
    }

    onKeyDown?.(e);
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        rows={rows}
        data-testid={testId}
        className={cn("w-full transition-colors", className)}
      />

      {isOpen && (
        <div
          data-testid="mention-autocomplete"
          className="absolute left-0 bottom-full mb-1 z-50 w-64 max-h-52 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg text-popover-foreground animate-in fade-in-0 zoom-in-95"
        >
          {isLoading ? (
            <div className="flex items-center justify-center p-3 text-xs text-muted-foreground gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Searching members...</span>
            </div>
          ) : loadedMembers.length > 0 ? (
            <div className="space-y-0.5">
              {loadedMembers.map((member, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={member.id}
                    data-testid="mention-item"
                    data-member-username={member.username}
                    onMouseDown={e => {
                      e.preventDefault(); // Prevent blur
                      selectMember(member);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-xs transition-colors",
                      isSelected ? "bg-accent text-accent-foreground font-medium" : "hover:bg-muted/60"
                    )}
                  >
                    <Avatar
                      size="sm"
                      name={member.name || member.username}
                      className="h-5 w-5 text-[10px] shrink-0"
                    />
                    <div className="flex-1 truncate">
                      <span className="font-medium text-foreground">
                        {member.name || member.username}
                      </span>
                      {member.name && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          @{member.username}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-2.5 text-center text-xs text-muted-foreground">
              No matching members found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
