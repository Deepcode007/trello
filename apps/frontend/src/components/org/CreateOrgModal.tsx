import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useOrgStore } from "../../store/useOrgStore";
import { Building2, AlertCircle, Loader2 } from "lucide-react";
import type { Organization } from "../../lib/org-api";

export interface CreateOrgModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (org: Organization) => void;
}

export function CreateOrgModal({
  open,
  onOpenChange,
  onSuccess
}: CreateOrgModalProps) {
  const createOrg = useOrgStore(s => s.createOrg);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visible, setVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset fields whenever dialog opens or closes
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setVisible(true);
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (!trimmedName) {
      setError("Organization name is required.");
      return;
    }

    if (!trimmedDesc) {
      setError("Organization description is required.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const result = await createOrg({
        name: trimmedName,
        description: trimmedDesc,
        visible
      });

      if (result.success && result.org) {
        onOpenChange(false);
        onSuccess?.(result.org);
      } else {
        setError(result.error || "Failed to create organization");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Create Organization</DialogTitle>
              <DialogDescription className="mt-0.5">
                Set up a new workspace for your team and boards.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="org-name" required>
              Organization Name
            </Label>
            <Input
              id="org-name"
              placeholder="e.g. Acme Engineering"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-description" required>
              Description
            </Label>
            <Input
              id="org-description"
              placeholder="Brief summary of this team or organization"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="org-visible"
              checked={visible}
              onChange={e => setVisible(e.target.checked)}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
            />
            <label
              htmlFor="org-visible"
              className="text-xs font-medium text-foreground cursor-pointer select-none"
            >
              Make organization publicly visible
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Organization"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
