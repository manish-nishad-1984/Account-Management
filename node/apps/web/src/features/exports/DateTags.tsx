import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, X } from "lucide-react";
import { dateTagListSchema, dateTagSchema, type DateTag } from "@accountmanagement/contracts";
import { ApiError, apiRequest, deleteRequest } from "../../lib/api-client";
import { askConfirm } from "../../components/ui/confirm";
import { describeRange } from "./date-presets";

const KEY = ["date-tags"];

/**
 * DATE TAGS (client, 26 Oct 2026): the dates on screen kept under a name, and
 * picked again in one click. Each person's own, kept on the server.
 */
export function DateTags({
  fromDate,
  toDate,
  onPick,
}: {
  fromDate: string;
  toDate: string;
  onPick: (range: { fromDate: string; toDate: string }) => void;
}) {
  const client = useQueryClient();
  const tags = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => apiRequest<{ tags: DateTag[] }>("/date-tags", { schema: dateTagListSchema, signal }),
  });
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { name: string; fromDate: string | null; toDate: string | null }) =>
      apiRequest<DateTag>("/date-tags", { method: "POST", body, schema: dateTagSchema }),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteRequest(`/date-tags/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setError(null);
    if (!name.trim()) {
      setError("Give the tag a name.");
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim(), fromDate: fromDate || null, toDate: toDate || null });
      setName("");
      setNaming(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The tag could not be saved.");
    }
  };

  const drop = async (tag: DateTag) => {
    const yes = await askConfirm({ title: "Remove tag", body: <p>Remove the tag &ldquo;{tag.name}&rdquo;? The data is not touched.</p> });
    if (yes) remove.mutate(tag.id);
  };

  const list = tags.data?.tags ?? [];
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saved date tags">
        {list.map((tag) => {
          const on = (tag.fromDate ?? "") === fromDate && (tag.toDate ?? "") === toDate;
          return (
            <span
              key={tag.id}
              className={clsx(
                "inline-flex items-center rounded-full text-xs font-medium ring-1 ring-inset",
                on ? "bg-violet-600 text-white ring-violet-600" : "bg-violet-50 text-violet-800 ring-violet-200",
              )}
            >
              <button
                type="button"
                aria-pressed={on}
                title={describeRange(tag.fromDate ?? "", tag.toDate ?? "")}
                onClick={() => onPick({ fromDate: tag.fromDate ?? "", toDate: tag.toDate ?? "" })}
                className="inline-flex items-center gap-1 py-1 pl-2.5 pr-1"
              >
                <Tag aria-hidden className="size-3" />
                {tag.name}
              </button>
              <button
                type="button"
                aria-label={`Remove tag ${tag.name}`}
                onClick={() => void drop(tag)}
                className={clsx("mr-1 rounded-full p-0.5", on ? "hover:bg-violet-500" : "hover:bg-violet-100")}
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          );
        })}
        {!naming && (
          <button
            type="button"
            onClick={() => {
              setNaming(true);
              setError(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus aria-hidden className="size-3" />
            Add tag
          </button>
        )}
      </div>
      {naming && (
        <form onSubmit={(event) => void save(event)} className="flex items-center gap-1.5">
          <input
            autoFocus
            aria-label="Tag name"
            value={name}
            maxLength={40}
            placeholder={`Name for ${describeRange(fromDate, toDate)}`}
            onChange={(event) => setName(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 px-2 text-xs focus:border-brand-500 focus:ring-brand-500"
          />
          <button type="submit" disabled={create.isPending} className="h-8 rounded-md bg-brand-600 px-2.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setNaming(false);
              setName("");
              setError(null);
            }}
            className="h-8 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
        </form>
      )}
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
