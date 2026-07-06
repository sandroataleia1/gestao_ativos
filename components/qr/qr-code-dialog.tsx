"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QrCodeSection, type QrResourceKind } from "./qr-code-section";

export type QrCodeDialogSection = {
  label: string;
  resourceKind: QrResourceKind;
  resourceId: string;
};

export function QrCodeDialog({
  open,
  onOpenChange,
  title,
  description,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  sections: QrCodeDialogSection[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="grid gap-3">
          {sections.map((section) => (
            <QrCodeSection key={`${section.resourceKind}-${section.resourceId}`} {...section} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
