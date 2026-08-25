import { useEffect, useState } from "react";
import { Link, useLoaderData, useSearchParams } from "react-router";

import {
  ORDER_CONFIRMATION_RECOMMENDED_SUBJECT,
  OWNERSHIP_REMINDERS,
  RESEND_SUBSCRIPTION_CREATED_SUBJECT,
  checklistForNotification,
} from "./shopify-notifications-catalog";
import type { loadShopifyNotificationsPageData } from "./shopify-notifications-data.server";
import {
  buttonRowStyle,
  codeBlockStyle,
  envPanelStyle,
  infoBannerStyle,
  introStyle,
  listStyle,
  mutedStyle,
  pageShellStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  statusBadgeStyle,
  summaryCardStyle,
  summaryGridStyle,
  summaryLabelStyle,
  summaryValueStyle,
  successBannerStyle,
  warningBannerStyle,
} from "./shopify-notifications-styles";
import type {
  ShopifyNotificationStatus,
  ShopifyNotificationTemplateDefinition,
} from "./shopify-notifications-types";

type PageData = Awaited<ReturnType<typeof loadShopifyNotificationsPageData>>;

const statusLabel = (status: ShopifyNotificationStatus): string => {
  switch (status) {
    case "ready":
      return "Template Mileyo prêt";
    case "todo":
      return "À personnaliser";
    case "needs_source":
      return "À préparer";
    case "shopify_system":
      return "Email système Shopify";
    case "not_editable":
      return "Personnalisation limitée";
    default:
      return status;
  }
};

const statusTone = (
  status: ShopifyNotificationStatus,
): "ready" | "todo" | "system" => {
  if (status === "ready") return "ready";
  if (status === "shopify_system" || status === "not_editable") return "system";
  return "todo";
};

const ownerLabel = (owner: ShopifyNotificationTemplateDefinition["owner"]) => {
  switch (owner) {
    case "shopify":
      return "Shopify";
    case "resend":
      return "Resend";
    case "shopify_and_mileyo":
      return "Shopify + Mileyo complémentaire";
    default:
      return owner;
  }
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
};

const openShopifyNotifications = (adminUrl: string) => {
  // No Admin Intent exists for customer notification templates
  // (only NotificationsStaff / NotificationsSenderEmail). Use a safe admin URL.
  window.open(adminUrl, "_blank", "noopener,noreferrer");
};

export default function ShopifyNotificationsPage() {
  const {
    notificationsAdminUrl,
    progress,
    selectedId,
    selectedOriginal,
    selectedTemplate,
    shop,
    templates,
  } = useLoaderData<PageData>();
  const [searchParams] = useSearchParams();
  const showOriginal = searchParams.get("view") === "original";
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = window.setTimeout(() => setCopyFeedback(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  const selected = templates.find((template) => template.id === selectedId);
  const codeToShow = showOriginal
    ? selectedOriginal?.content
    : selectedTemplate?.content;

  const handleCopyTemplate = async () => {
    if (!codeToShow) return;
    const ok = await copyText(codeToShow);
    setCopyFeedback(ok ? "Template copié" : "Copie impossible — sélectionnez le code manuellement");
  };

  const handleCopySubject = async () => {
    const subject =
      selected?.recommendedSubject ?? ORDER_CONFIRMATION_RECOMMENDED_SUBJECT;
    const ok = await copyText(subject);
    setCopyFeedback(ok ? "Objet copié" : "Copie impossible");
  };

  const handleCopyInstructions = async () => {
    const checklist = checklistForNotification(selected?.id ?? "");
    const text = [
      `Appliquer le template Mileyo — ${selected?.name ?? "Notification Shopify"}`,
      "",
      `Objet Shopify (champ séparé) : ${selected?.recommendedSubject ?? ORDER_CONFIRMATION_RECOMMENDED_SUBJECT}`,
      "",
      ...checklist.map((step, index) => `${index + 1}. ${step}`),
      "",
      `Boutique : ${shop}`,
      `Shopify : ${notificationsAdminUrl}`,
      selected
        ? `Puis ouvrez « ${selected.shopifyAdminLabel} ».`
        : "Puis ouvrez la notification concernée.",
      "",
      "Avant de coller : copiez et sauvegardez le template Shopify actuel (rollback).",
      "Note : Copier le template ne modifie PAS l’objet — copiez l’objet séparément.",
    ].join("\n");
    const ok = await copyText(text);
    setCopyFeedback(ok ? "Instructions copiées" : "Copie impossible");
  };

  if (selected && selected.status === "ready") {
    const snapshotUnlocked =
      selected.originalSnapshotProvenance !== "store_dump_locked";

    return (
      <s-page heading="Notifications Shopify">
        <s-section>
          <div style={pageShellStyle}>
            <s-stack gap="base">
              <p style={introStyle}>
                <Link to="/app/shopify-notifications">← Retour à la liste</Link>
              </p>
              <s-text>
                <strong>{selected.name}</strong>
              </s-text>
              <s-text>{selected.description}</s-text>
              <s-text>Owner : {ownerLabel(selected.owner)}</s-text>
              <s-text>
                Emplacement Shopify : {selected.adminPathHint}
              </s-text>
              <s-text>Boutique : {shop}</s-text>

              {selected.recommendedSubject ? (
                <s-box borderRadius="base" borderWidth="base" padding="base">
                  <s-stack gap="small">
                    <s-text>
                      <strong>Objet recommandé (champ Shopify séparé)</strong>
                    </s-text>
                    <s-text>{selected.recommendedSubject}</s-text>
                    <p style={infoBannerStyle}>
                      « Copier le template » ne change pas l’objet. L’objet se
                      colle dans le champ Subject / Objet de Shopify Admin.
                    </p>
                    <div style={buttonRowStyle}>
                      <button
                        onClick={() => void handleCopySubject()}
                        style={primaryButtonStyle}
                        type="button"
                      >
                        Copier l’objet
                      </button>
                    </div>
                    {selected.shopifySubjectHint ? (
                      <p style={mutedStyle}>
                        Subject Shopify typique actuel :{" "}
                        {selected.shopifySubjectHint}
                      </p>
                    ) : null}
                    {selected.id === "order-confirmation" ? (
                      <p style={mutedStyle}>
                        ≠ Resend « {RESEND_SUBSCRIPTION_CREATED_SUBJECT} ». Ne
                        pas laisser « Commande #… confirmée ».
                      </p>
                    ) : null}
                  </s-stack>
                </s-box>
              ) : null}

              {snapshotUnlocked ? (
                <p style={warningBannerStyle}>
                  Snapshot original non verrouillé sur le dump réel du store.
                  N’appliquez pas ce template dans Shopify tant que le code «{" "}
                  {selected.shopifyAdminLabel} » n’a pas été collé depuis
                  l’Admin du store DEV et versionné.
                </p>
              ) : null}

              <p style={warningBannerStyle}>
                Ne supprimez pas la logique Liquid (conditions, boucles,
                variables Shopify). Remplacez uniquement le HTML/Liquid fourni
                ici, en entier.
              </p>
              <p style={infoBannerStyle}>
                Avant de remplacer un template existant : copiez son contenu
                actuel et sauvegardez-le (rollback). Une version Shopify
                d’origine est disponible ci-dessous.
              </p>

              {copyFeedback ? (
                <p style={successBannerStyle}>{copyFeedback}</p>
              ) : null}

              <div style={buttonRowStyle}>
                <button
                  disabled={snapshotUnlocked}
                  onClick={() => void handleCopyTemplate()}
                  style={{
                    ...primaryButtonStyle,
                    ...(snapshotUnlocked
                      ? { cursor: "not-allowed" as const, opacity: 0.55 }
                      : {}),
                  }}
                  type="button"
                >
                  Copier le template
                </button>
                <button
                  onClick={() =>
                    openShopifyNotifications(notificationsAdminUrl)
                  }
                  style={secondaryButtonStyle}
                  type="button"
                >
                  Ouvrir Shopify
                </button>
                <button
                  onClick={() => void handleCopyInstructions()}
                  style={secondaryButtonStyle}
                  type="button"
                >
                  Copier les instructions
                </button>
                {!showOriginal ? (
                  <Link
                    style={secondaryButtonStyle}
                    to={`/app/shopify-notifications?template=${selected.id}&view=original`}
                  >
                    Voir la version Shopify d’origine
                  </Link>
                ) : (
                  <Link
                    style={secondaryButtonStyle}
                    to={`/app/shopify-notifications?template=${selected.id}`}
                  >
                    Voir le template Mileyo
                  </Link>
                )}
              </div>

              <p style={mutedStyle}>
                Puis ouvrez « {selected.shopifyAdminLabel} » dans Shopify Admin.
              </p>
              <p style={mutedStyle}>Lien ciblé : {notificationsAdminUrl}</p>

              <s-section
                heading={
                  showOriginal
                    ? "Version Shopify d’origine (code)"
                    : "Code du template"
                }
              >
                <p style={mutedStyle}>
                  Corps HTML/Liquid uniquement — l’objet se copie séparément
                  ci-dessus.
                </p>
                <textarea
                  aria-label={
                    showOriginal
                      ? "Code Liquid Shopify d’origine"
                      : "Code Liquid Mileyo"
                  }
                  readOnly
                  style={codeBlockStyle}
                  value={codeToShow ?? ""}
                />
              </s-section>

              {!showOriginal ? (
                <s-section heading="Checklist de déploiement">
                  <ol style={listStyle}>
                    {checklistForNotification(selected.id).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </s-section>
              ) : null}
            </s-stack>
          </div>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Notifications Shopify">
      <s-section>
        <s-stack gap="base">
          <p style={introStyle}>
            Certaines notifications client sont envoyées directement par
            Shopify. Mileyo fournit ici les versions personnalisées à appliquer
            dans Shopify Admin.
          </p>
          <p style={warningBannerStyle}>
            Shopify ne permet pas à une app de remplacer automatiquement le code
            de ces notifications. Copiez le template puis collez-le dans
            Shopify.
          </p>
          {templates.some(
            (template) =>
              template.status === "ready" &&
              template.originalSnapshotProvenance !== "store_dump_locked",
          ) ? (
            <p style={warningBannerStyle}>
              Au moins un template prêt a un snapshot original encore
              provisoire (pas le dump réel du store). Application Shopify DEV
              bloquée jusqu’au verrouillage du template Admin.
            </p>
          ) : null}
          <s-text>Boutique : {shop}</s-text>

          <div style={summaryGridStyle}>
            <div style={summaryCardStyle}>
              <p style={summaryLabelStyle}>Prêts dans Mileyo</p>
              <p style={summaryValueStyle}>
                {progress.ready} / {progress.total}
              </p>
            </div>
            <div style={summaryCardStyle}>
              <p style={summaryLabelStyle}>À préparer</p>
              <p style={summaryValueStyle}>
                {progress.needsSource + progress.todo}
              </p>
            </div>
            <div style={summaryCardStyle}>
              <p style={summaryLabelStyle}>Système Shopify</p>
              <p style={summaryValueStyle}>{progress.shopifySystem}</p>
            </div>
          </div>
          <p style={mutedStyle}>
            « Prêt dans Mileyo » ≠ installé dans Shopify. Cette page ne peut pas
            vérifier le code actuellement publié chez Shopify.
          </p>

          <div style={envPanelStyle}>
            <div>
              <s-text>
                <strong>DEV</strong>
              </s-text>
              <p style={mutedStyle}>
                Utilisez cette page sur le store de test pour valider les
                templates avant prod.
              </p>
            </div>
            <div>
              <s-text>
                <strong>PROD</strong>
              </s-text>
              <p style={mutedStyle}>
                Après installation de Mileyo sur le store client, ouvrez la même
                page puis appliquez exactement les mêmes templates versionnés.
              </p>
            </div>
          </div>

          <s-section heading="Ownership">
            <ul style={listStyle}>
              {OWNERSHIP_REMINDERS.map((item) => (
                <li key={item.label}>
                  {item.label} → {item.owner}
                </li>
              ))}
            </ul>
          </s-section>

          {templates.map((template) => {
            const ready = template.status === "ready";
            return (
              <s-box
                key={template.id}
                borderRadius="base"
                borderWidth="base"
                padding="base"
              >
                <s-stack gap="small">
                  <s-text>
                    <strong>{template.name}</strong>
                  </s-text>
                  <s-text>{template.role}</s-text>
                  <s-text>Owner : {ownerLabel(template.owner)}</s-text>
                  <span style={statusBadgeStyle(statusTone(template.status))}>
                    {statusLabel(template.status)}
                  </span>
                  <s-text>
                    Template Mileyo prêt : {ready ? "oui" : "non"}
                  </s-text>
                  {template.notes ? (
                    <p style={mutedStyle}>{template.notes}</p>
                  ) : null}
                  <div style={buttonRowStyle}>
                    {ready ? (
                      <>
                        <Link
                          style={primaryButtonStyle}
                          to={`/app/shopify-notifications?template=${template.id}`}
                        >
                          Voir le template
                        </Link>
                        <button
                          onClick={() =>
                            openShopifyNotifications(notificationsAdminUrl)
                          }
                          style={secondaryButtonStyle}
                          type="button"
                        >
                          Ouvrir Shopify
                        </button>
                      </>
                    ) : template.status === "shopify_system" ? (
                      <s-text>
                        Ne pas désactiver — lien sécurisé de mise à jour carte.
                      </s-text>
                    ) : (
                      <s-text>Pas encore disponible</s-text>
                    )}
                  </div>
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-section>
    </s-page>
  );
}
