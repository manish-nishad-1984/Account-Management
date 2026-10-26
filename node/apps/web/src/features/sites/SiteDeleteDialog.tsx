import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import { siteContentsSchema, type SiteContents } from "@accountmanagement/contracts";
import { Alert, Button, Modal, TextField } from "../../components/ui";
import { ApiError, apiRequest } from "../../lib/api-client";
import { formatMoney } from "../../lib/format";

/**
 * DELETE A SITE WITH EVERYTHING IN IT (client, 26 Oct 2026). Shows what the
 * site holds, asks for the person's own login password, and takes it all in one
 * go: no more deleting invoices, then data, then deactivating, then deleting.
 */
export function SiteDeleteDialog({ site, onClose }: { site: { id: string; name: string } | null; onClose: () => void }) {
  const client = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword("");
    setError(null);
  }, [site?.id]);

  const contents = useQuery({
    queryKey: ["sites", "contents", site?.id],
    enabled: site !== null,
    queryFn: ({ signal }) => apiRequest<SiteContents>(`/sites/${site!.id}/contents`, { schema: siteContentsSchema, signal }),
  });
  const purge = useMutation({
    mutationFn: (body: { password: string }) =>
      apiRequest<SiteContents>(`/sites/${site!.id}/delete-everything`, { method: "POST", body, schema: siteContentsSchema }),
    // Every list may have held something of the site; but not this site's contents,
    // which are gone, and asking again would only answer 404.
    onSuccess: () => {
      client.removeQueries({ queryKey: ["sites", "contents", site?.id] });
      return client.invalidateQueries({ predicate: (query) => !(query.queryKey[0] === "sites" && query.queryKey[1] === "contents") });
    },
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError("Enter your password.");
      return;
    }
    try {
      await purge.mutateAsync({ password });
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The site could not be deleted. Please try again.");
    }
  };

  const data = contents.data;
  const lines: [string, number, string?][] = data
    ? [
        ["Purchase invoices", data.purchaseInvoices, data.purchaseInvoices > 0 ? formatMoney(data.billedTotal) : undefined],
        ["Payments", data.payments, data.payments > 0 ? `${formatMoney(data.paidTotal)} paid` : undefined],
        ["Sales invoices", data.salesInvoices],
        ["Income entries", data.incomes],
        ["Purchase requests", data.purchaseRequests],
        ["Purchase orders", data.purchaseOrders],
        ["Inward challans", data.inwardChallans],
        ["Inventory arrivals", data.inventoryArrivals],
        ["Site locations", data.locations],
        ["Users with access", data.users],
      ]
    : [];
  const held = lines.filter(([, count]) => count > 0);

  return (
    <Modal
      open={site !== null}
      onClose={onClose}
      title="Delete site"
      description={site?.name}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} type="submit" form="site-delete-form" loading={purge.isPending} disabled={!data}>
            Delete site and everything in it
          </Button>
        </>
      }
    >
      <form id="site-delete-form" onSubmit={(event) => void submit(event)} className="space-y-4">
        {contents.isLoading && <p className="text-sm text-slate-500">Checking what the site holds…</p>}
        {contents.isError && <Alert>{contents.error instanceof ApiError ? contents.error.message : "Could not read the site."}</Alert>}
        {data && (
          <>
            <Alert icon={AlertTriangle}>
              {held.length === 0 ? (
                <>
                  <span className="font-medium">{data.siteName}</span> holds nothing else. It is deleted on its own.
                </>
              ) : (
                <>
                  Everything of <span className="font-medium">{data.siteName}</span> below is deleted with it, and cannot be brought back
                  from the screens.
                </>
              )}
            </Alert>
            {held.length > 0 && (
              <table aria-label="What is deleted" className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {held.map(([label, count, extra]) => (
                    <tr key={label}>
                      <td className="py-1.5 pr-3 text-slate-700">{label}</td>
                      <td className="tabular py-1.5 pr-3 text-right font-medium text-slate-900">{count.toLocaleString("en-IN")}</td>
                      <td className="tabular py-1.5 text-right text-xs text-slate-500">{extra ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-slate-500">
              Employees of this site are kept, with no site. Saved balance sheets keep what they were saved with. The delete is
              recorded with your name.
            </p>
            <TextField
              label="Your password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </>
        )}
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}
