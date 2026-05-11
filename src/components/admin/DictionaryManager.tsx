"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { saveDictionaryItem, deleteDictionaryItem } from "@/server/actions/admin";
import type { AdminDictionaryItem } from "@/types/portfolio";
import { Trash2 } from "lucide-react";

const schema = z.object({
  itemKey: z.string().min(1).max(100),
  displayName: z.string().min(1),
  itemType: z.enum(["non_listed", "cash"]),
  subcategory: z.string().optional(),
  currency: z.string().length(3).default("EUR"),
  sortOrder: z.coerce.number().int().default(0),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  items: AdminDictionaryItem[];
  onSaved?: () => void;
}

export function DictionaryManager({ items, onSaved }: Props) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { itemType: "non_listed", currency: "EUR", sortOrder: 0 },
  });

  async function onSubmit(values: FormValues) {
    setStatus("saving");
    const result = await saveDictionaryItem(values);
    if (result?.data?.success) {
      setStatus("saved");
      reset();
      onSaved?.();
      setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("error");
    }
  }

  async function handleDelete(itemKey: string) {
    if (!confirm(`Remove "${itemKey}" from the dictionary?`)) return;
    await deleteDictionaryItem({ itemKey });
    onSaved?.();
  }

  return (
    <div className="space-y-6">
      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Key (item_key)</label>
            <input
              {...register("itemKey")}
              placeholder="e.g. fund_xyz"
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {errors.itemKey && <p className="text-destructive text-xs mt-0.5">Required</p>}
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Display Name</label>
            <input
              {...register("displayName")}
              placeholder="e.g. Fund XYZ"
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
            <select
              {...register("itemType")}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="non_listed">Non-Listed</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Currency</label>
            <input
              {...register("currency")}
              placeholder="EUR"
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Sort Order</label>
            <input
              {...register("sortOrder")}
              type="number"
              defaultValue={0}
              className="w-full px-3 py-2 bg-secondary/50 border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={status === "saving"}
          className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : "Add / Update"}
        </button>
      </form>

      {/* Table */}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Key</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Currency</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.itemKey} className="hover:bg-secondary/20">
                  <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{item.itemKey}</td>
                  <td className="px-4 py-2.5 text-foreground">{item.displayName}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-muted-foreground border border-border">
                      {item.itemType === "non_listed" ? "Non-Listed" : "Cash"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{item.currency}</td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => handleDelete(item.itemKey)}
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
