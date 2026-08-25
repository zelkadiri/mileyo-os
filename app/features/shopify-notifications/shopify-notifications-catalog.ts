import type {
  ShopifyNotificationProgressSummary,
  ShopifyNotificationTemplateDefinition,
} from "./shopify-notifications-types";

/** Shopify Admin subject field — separate from HTML body. */
export const ORDER_CONFIRMATION_RECOMMENDED_SUBJECT =
  "Récapitulatif de votre commande Mileyo" as const;

/** Shopify Admin subject field — separate from HTML body. */
export const SHIPPING_CONFIRMATION_RECOMMENDED_SUBJECT =
  "Votre commande {{ order_name }} est en route" as const;

/** Shopify Admin subject field — separate from HTML body. */
export const SHIPPING_UPDATE_RECOMMENDED_SUBJECT =
  "Mise à jour de l’expédition de votre commande {{ order_name }}" as const;

/** Shopify Admin subject field — separate from HTML body. */
export const OUT_FOR_DELIVERY_RECOMMENDED_SUBJECT =
  "Votre commande {{ order_name }} est en cours de livraison" as const;

/**
 * Shopify Admin subject field — separate from HTML body.
 * Robust generic (subject cannot safely mirror all fulfillment branches).
 */
export const DELIVERED_RECOMMENDED_SUBJECT =
  "Votre commande Mileyo a été livrée" as const;

/** Shopify Admin subject field — separate from HTML body. No financial wording. */
export const ORDER_CANCELLED_RECOMMENDED_SUBJECT =
  "Votre commande Mileyo a été annulée" as const;

/**
 * Shopify Admin subject field — separate from HTML body.
 * Generic: covers total / partial / no refund_line_items (subject cannot mirror all branches).
 */
export const REFUND_RECOMMENDED_SUBJECT =
  "Votre remboursement Mileyo a été effectué" as const;

/**
 * Shopify Admin subject field — separate from HTML body.
 * Actionable; avoids “paiement échoué” (template can fire outside failure).
 */
export const PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT =
  "Mettez à jour votre moyen de paiement Mileyo" as const;

/** Distinguish from Resend SubscriptionCreated subject. */
export const RESEND_SUBSCRIPTION_CREATED_SUBJECT =
  "Votre abonnement Mileyo est confirmé" as const;

/**
 * Design contract — typography for all Mileyo Shopify notification Liquid.
 * Titles use the same sans stack (weight / size / color / letter-spacing for hierarchy).
 * Empattement interdit. No @font-face in emails — Inter is preferential only.
 */
export const SHOPIFY_NOTIFICATION_MILEYO_FONT_STACK =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif' as const;

/**
 * Versioned catalog of Shopify-owned customer notifications to customize.
 * Status "ready" means Mileyo liquid is available to copy — not installed in Shopify.
 */
export const SHOPIFY_NOTIFICATION_TEMPLATES: ShopifyNotificationTemplateDefinition[] =
  [
    {
      adminPathHint: "Settings → Notifications → Order confirmation",
      description:
        "Email envoyé automatiquement par Shopify après chaque commande Online Store.",
      id: "order-confirmation",
      mileyoTemplateFile: "order-confirmation.mileyo.liquid",
      name: "Confirmation de commande",
      notes:
        "Owner Shopify. Snapshot Admin DEV verrouillé. Subject Admin à coller séparément : « Récapitulatif de votre commande Mileyo ». CTA primaire → espace Mileyo ({{ shop.url }}/apps/box-builder/portal), pas order_status_url.",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "order-confirmation.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: ORDER_CONFIRMATION_RECOMMENDED_SUBJECT,
      roadmapGroup: "A",
      role: "Reçu / récapitulatif de commande (Shopify) — distinct de Resend abonnement.",
      shopifyAdminLabel: "Confirmation de commande",
      shopifySubjectHint: "Commande {{name}} confirmée (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Shipping confirmation",
      description:
        "Email d’expédition avec suivi, envoyé par Shopify à la fulfillment.",
      id: "shipping-confirmation",
      mileyoTemplateFile: "shipping-confirmation.mileyo.liquid",
      name: "Confirmation d’expédition",
      notes:
        "Owner Shopify. Snapshot FR verrouillé. Subject Admin à coller séparément : « Votre commande {{ order_name }} est en route ». Diffs Mileyo = branding/UX shipping (CTA suivi, ETA, tracking).",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "shipping-confirmation.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: SHIPPING_CONFIRMATION_RECOMMENDED_SUBJECT,
      roadmapGroup: "B",
      role: "Confirme qu’une commande (ou partie) a été expédiée — suivi + articles de cet envoi.",
      shopifyAdminLabel: "Confirmation d’expédition",
      shopifySubjectHint:
        "Un envoi a été expédié pour la commande {{ name }} (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Shipping update",
      description:
        "Email Shopify quand de nouveaux détails d’expédition sont disponibles (suivi, transporteur, URL).",
      id: "shipping-update",
      mileyoTemplateFile: "shipping-update.mileyo.liquid",
      name: "Mise à jour d’expédition",
      notes:
        "Owner Shopify. Snapshot FR verrouillé. Subject Admin à coller séparément : « Mise à jour de l’expédition de votre commande {{ order_name }} ». Diffs Mileyo = branding/UX (CTA suivi mis à jour, tracking, sans email_emphasis vide).",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "shipping-update.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: SHIPPING_UPDATE_RECOMMENDED_SUBJECT,
      roadmapGroup: "B",
      role: "Nouveaux détails sur une expédition existante (suivi / transporteur) — pas une nouvelle commande.",
      shopifyAdminLabel: "Mise à jour d’expédition",
      shopifySubjectHint:
        "Une mise à jour d’expédition a été effectuée pour la commande {{ name }} (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Out for delivery",
      description:
        "Email Shopify quand le transporteur signale le colis en cours de livraison.",
      id: "out-for-delivery",
      mileyoTemplateFile: "out-for-delivery.mileyo.liquid",
      name: "En cours de livraison",
      notes:
        "Owner Shopify. Snapshot FR verrouillé. Subject Admin à coller séparément : « Votre commande {{ order_name }} est en cours de livraison ». Pas de Shop App dans le template original — ne pas l’ajouter. Diffs Mileyo = branding/UX (CTA suivi, ETA, tracking).",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "out-for-delivery.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: OUT_FOR_DELIVERY_RECOMMENDED_SUBJECT,
      roadmapGroup: "C",
      role: "Annonce que le colis (ou une partie) est en livraison — suivi + ETA si dispo.",
      shopifyAdminLabel: "En cours de livraison",
      shopifySubjectHint:
        "Un envoi de la commande {{ name }} est en cours de livraison (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Delivered",
      description:
        "Email Shopify quand le transporteur signale le colis comme livré.",
      id: "delivered",
      mileyoTemplateFile: "delivered.mileyo.liquid",
      name: "Livré",
      notes:
        "Owner Shopify. Snapshot FR store DEV (manuel). Subject Admin à coller séparément : « Votre commande Mileyo a été livrée ». Pas de CTA commande/boutique — bloc aide + tracking + articles. Diffs Mileyo = branding/UX post-livraison.",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "delivered.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: DELIVERED_RECOMMENDED_SUBJECT,
      roadmapGroup: "C",
      role: "Confirme que le colis (ou une partie) a été livré — aide si introuvable + suivi + articles.",
      shopifyAdminLabel: "Livré",
      shopifySubjectHint:
        "Un envoi de la commande {{ name }} a été livré (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Order cancelled",
      description:
        "Email Shopify quand une commande est annulée — raison + statut paiement.",
      id: "order-cancelled",
      mileyoTemplateFile: "order-cancelled.mileyo.liquid",
      name: "Commande annulée",
      notes:
        "Owner Shopify. Snapshot FR store DEV (manuel). Subject Admin à coller séparément : « Votre commande Mileyo a été annulée ». Pas de CTA commande/boutique — statut paiement + articles + récap. Diffs Mileyo = branding/UX annulation.",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "order-cancelled.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: ORDER_CANCELLED_RECOMMENDED_SUBJECT,
      roadmapGroup: "D",
      role: "Informe le client de l’annulation et du statut du paiement.",
      shopifyAdminLabel: "Commande annulée",
      shopifySubjectHint:
        "Commande {{ name }} annulée (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Order refund",
      description:
        "Email Shopify quand un remboursement est traité — montant, articles, délai bancaire.",
      id: "refund",
      mileyoTemplateFile: "refund.mileyo.liquid",
      name: "Remboursement",
      notes:
        "Owner Shopify. Snapshot FR store DEV (manuel). Subject Admin à coller séparément : « Votre remboursement Mileyo a été effectué ». Pas de CTA commande/boutique — montant + récap + store credit si applicable. Diffs Mileyo = branding/UX remboursement.",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "refund.shopify-original.liquid",
      owner: "shopify",
      recommendedSubject: REFUND_RECOMMENDED_SUBJECT,
      roadmapGroup: "D",
      role: "Confirme un remboursement (montant, articles, délai bancaire).",
      shopifyAdminLabel: "Remboursement",
      shopifySubjectHint:
        "Remboursement de la commande {{ name }} (subject Shopify actuel typique)",
      status: "ready",
    },
    {
      adminPathHint: "Settings → Notifications → Abandoned checkout",
      description: "Relance panier / checkout abandonné (Shopify).",
      id: "abandoned-checkout",
      mileyoTemplateFile: null,
      name: "Checkout abandonné",
      notes: "Roadmap E — à personnaliser quand le source exact est fourni.",
      originalTemplateFile: null,
      owner: "shopify",
      roadmapGroup: "E",
      role: "Relance le client qui n’a pas finalisé le paiement.",
      shopifyAdminLabel: "Checkout abandonné",
      status: "todo",
    },
    {
      adminPathHint:
        "Settings → Notifications → Customer payment method update request",
      description:
        "Email Shopify avec le lien sécurisé (email_confirmation_url) pour mettre à jour le moyen de paiement — complémentaire au PaymentFailed Resend.",
      id: "payment-method-update",
      mileyoTemplateFile: "payment-method-update.mileyo.liquid",
      name: "Mise à jour du moyen de paiement",
      notes:
        "Owner Shopify + Mileyo complémentaire. Snapshot FR store DEV (manuel). Subject Admin à coller séparément : « Mettez à jour votre moyen de paiement Mileyo ». CTA unique → {{ email_confirmation_url }}. Ne pas désactiver. Flow V1 customerPaymentMethodSendUpdateEmail inchangé (ENABLE_SHOPIFY_PAYMENT_UPDATE_EMAIL).",
      originalSnapshotProvenance: "store_dump_locked",
      originalTemplateFile: "payment-method-update.shopify-original.liquid",
      owner: "shopify_and_mileyo",
      recommendedSubject: PAYMENT_METHOD_UPDATE_RECOMMENDED_SUBJECT,
      roadmapGroup: "F",
      role: "Lien sécurisé Shopify pour mettre à jour la carte (complémentaire au PaymentFailed Resend).",
      shopifyAdminLabel:
        "Demande de mise à jour du moyen de paiement du client",
      shopifySubjectHint:
        "Mettre à jour votre moyen de paiement pour {{ shop.name }} (subject Shopify actuel typique)",
      status: "ready",
    },
  ];

export const buildShopifyNotificationProgress = (
  templates: ShopifyNotificationTemplateDefinition[] = SHOPIFY_NOTIFICATION_TEMPLATES,
): ShopifyNotificationProgressSummary => {
  const progress: ShopifyNotificationProgressSummary = {
    needsSource: 0,
    ready: 0,
    shopifySystem: 0,
    todo: 0,
    total: templates.length,
  };

  for (const template of templates) {
    if (template.status === "ready") progress.ready += 1;
    else if (template.status === "todo") progress.todo += 1;
    else if (template.status === "needs_source") progress.needsSource += 1;
    else if (
      template.status === "shopify_system" ||
      template.status === "not_editable"
    ) {
      progress.shopifySystem += 1;
    }
  }

  return progress;
};

export const findShopifyNotificationById = (
  id: string,
): ShopifyNotificationTemplateDefinition | undefined =>
  SHOPIFY_NOTIFICATION_TEMPLATES.find((template) => template.id === id);

export const OWNERSHIP_REMINDERS = [
  {
    label: "Confirmation de commande",
    owner: "Shopify",
  },
  {
    label: "Expédition / suivi",
    owner: "Shopify",
  },
  {
    label: "Remboursement / annulation",
    owner: "Shopify",
  },
  {
    label: "Mise à jour carte (lien sécurisé)",
    owner: "Shopify",
  },
  {
    label: "Emails repas / abonnement",
    owner: "Resend (Mileyo)",
  },
] as const;

export const ORDER_CONFIRMATION_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Confirmation de commande → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Confirmation de commande",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const SHIPPING_CONFIRMATION_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Confirmation d’expédition → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Confirmation d’expédition",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier expédition complète",
  "Vérifier expédition partielle si le preview Shopify le permet",
  "Vérifier tracking visible",
  "Vérifier date estimée lorsqu’elle existe",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const SHIPPING_UPDATE_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Mise à jour d’expédition → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Mise à jour d’expédition",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier tracking simple",
  "Vérifier tracking multiple si le preview Shopify le permet",
  "Vérifier Shop App / fallback préservé",
  "Vérifier produits du fulfillment visibles",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const OUT_FOR_DELIVERY_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → En cours de livraison → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → En cours de livraison",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier livraison complète / partielle si le preview le permet",
  "Vérifier tracking visible",
  "Vérifier date estimée lorsqu’elle existe",
  "Vérifier produits du fulfillment visibles",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const DELIVERED_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Livré → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Livré",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier livraison complète / partielle si le preview le permet",
  "Vérifier le bloc « Vous ne trouvez pas votre colis ? »",
  "Vérifier tracking visible (si fourni)",
  "Vérifier produits du fulfillment visibles",
  "Confirmer l’absence de CTA Afficher votre commande / Visitez notre boutique",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const ORDER_CANCELLED_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Commande annulée → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Commande annulée",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier les branches voided / refunded / paid si le preview le permet",
  "Vérifier le bloc Statut du paiement",
  "Vérifier Articles annulés + récap financier",
  "Confirmer l’absence de CTA commande / boutique / abonnement",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const REFUND_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Remboursement → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Remboursement",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier remboursement total / partiel / sans articles si le preview le permet",
  "Vérifier le bloc Montant remboursé",
  "Vérifier le texte délai bancaire (jusqu’à 10 jours)",
  "Vérifier le récap commande + transactions / store credit",
  "Confirmer l’absence de CTA commande / boutique / abonnement",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

export const PAYMENT_METHOD_UPDATE_CHECKLIST = [
  "Copier l’objet recommandé",
  "Dans Shopify → Demande de mise à jour du moyen de paiement du client → coller l’objet (champ Subject / Objet)",
  "Copier le template Mileyo",
  "Ouvrir Shopify → Paramètres → Notifications → Demande de mise à jour du moyen de paiement du client",
  "Modifier le code → tout sélectionner → coller le template",
  "Enregistrer",
  "Prévisualiser (Shopify DEV)",
  "Vérifier desktop + mobile",
  "Vérifier que le CTA pointe vers {{ email_confirmation_url }}",
  "Confirmer l’absence de CTA commande / boutique / abonnement",
  "Confirmer que le rollback (version d’origine) reste disponible ici",
  "Envoyer un email de test (après validation visuelle)",
] as const;

/**
 * Liquid tokens that must exist in BOTH the locked store dump and the Mileyo variant.
 * Used by suite 75 — not a full Liquid parser.
 * Portal CTA uses shop.url + /apps/box-builder/portal (not order_status_url).
 */
export const ORDER_CONFIRMATION_CRITICAL_LIQUID_TOKENS = [
  "delivery_method_types",
  "has_split_cart",
  "non_none_agreements_count",
  "has_pending_payment",
  "buyer_action_required",
  "payment_charged_on_fulfillment",
  "delivery_instructions",
  "consolidated_estimated_delivery_time",
  "shop_app_tracking_url",
  "nested_line_child",
  "line_item_groups",
  "delivery_agreements",
  "discount_allocations",
  "attach_as_pdf",
  "payment_terms",
  "shipping_address",
  "billing_address",
  "transactions",
] as const;

/**
 * Liquid tokens that must exist in BOTH shipping confirmation original + Mileyo.
 * Used by suite 75 — not a full Liquid parser.
 * Generic commande CTA → portal; tracking URLs unchanged.
 */
export const SHIPPING_CONFIRMATION_CRITICAL_LIQUID_TOKENS = [
  "fulfillment.item_count",
  "item_count",
  "fulfillment_status",
  "fulfilled",
  "fulfillment.estimated_delivery_at",
  "shop_app_tracking_url",
  "shop_app_tracking_button_variant_key",
  "track_with_shop",
  "fulfillment.tracking_numbers",
  "fulfillment.tracking_url",
  "fulfillment.tracking_urls",
  "fulfillment.fulfillment_line_items",
  "nested_line_child",
  "nested_line_parent",
  "bundle_parent",
  "selling_plan_allocation",
  "discount_allocations",
  "shopify-shop-marketplace-footer",
] as const;

/**
 * Liquid tokens that must exist in BOTH shipping update original + Mileyo.
 * Used by suite 75 — not a full Liquid parser.
 * Note: email_emphasis is original-only (undefined capture in Shopify dump).
 */
export const SHIPPING_UPDATE_CRITICAL_LIQUID_TOKENS = [
  "shop_app_tracking_url",
  "shop_app_tracking_button_variant_key",
  "track_with_shop",
  "fulfillment.tracking_numbers",
  "fulfillment.tracking_company",
  "fulfillment.tracking_url",
  "fulfillment.tracking_urls",
  "fulfillment.fulfillment_line_items",
  "nested_line_child",
  "nested_line_parent",
  "bundle_parent",
  "selling_plan_allocation",
  "discount_allocations",
  "shopify-shop-marketplace-footer",
] as const;

/**
 * Liquid tokens that must exist in BOTH out-for-delivery original + Mileyo.
 * No Shop App tokens — absent from this Shopify template.
 * Fallback CTA → portal (tracking preserved when present).
 */
export const OUT_FOR_DELIVERY_CRITICAL_LIQUID_TOKENS = [
  "fulfillment.item_count",
  "item_count",
  "fulfillment_status",
  "fulfilled",
  "fulfillment.estimated_delivery_at",
  "fulfillment.tracking_numbers",
  "fulfillment.tracking_url",
  "fulfillment.tracking_urls",
  "fulfillment.fulfillment_line_items",
  "nested_line_child",
  "nested_line_parent",
  "bundle_parent",
  "selling_plan_allocation",
  "discount_allocations",
  "shopify-shop-marketplace-footer",
] as const;

/**
 * Liquid tokens that must exist in BOTH delivered original + Mileyo.
 * No ETA / Shop App. order_status_url kept in original only (CTA removed in Mileyo).
 */
export const DELIVERED_CRITICAL_LIQUID_TOKENS = [
  "fulfillment.item_count",
  "item_count",
  "fulfillment_status",
  "fulfilled",
  "fulfillment.tracking_numbers",
  "fulfillment.tracking_url",
  "fulfillment.tracking_urls",
  "fulfillment.fulfillment_line_items",
  "nested_line_child",
  "nested_line_parent",
  "bundle_parent",
  "selling_plan_allocation",
  "discount_allocations",
  "shopify-shop-marketplace-footer",
] as const;

/**
 * Liquid tokens that must exist in BOTH order-cancelled original + Mileyo.
 */
export const ORDER_CANCELLED_CRITICAL_LIQUID_TOKENS = [
  "financial_status",
  "cancel_reason",
  "subtotal_line_items",
  "nested_line_child",
  "nested_line_parent",
  "bundle_parent",
  "selling_plan_allocation",
  "discount_allocations",
  "discount_applications",
  "shipping_methods",
  "pickup_methods",
  "payment_terms",
  "total_duties",
  "total_tip",
  "transactions",
  "gift_card",
  "unit_price_measurement",
  "shopify-shop-marketplace-footer",
] as const;

/**
 * Liquid tokens that must exist in BOTH refund original + Mileyo.
 */
export const REFUND_CRITICAL_LIQUID_TOKENS = [
  "refund_line_items",
  "item_count",
  "amount",
  "money_with_currency",
  "line_items_including_zero_quantity",
  "subtotal_line_items",
  "bundle_parent",
  "bundle_components",
  "selling_plan_allocation",
  "aggregated_update",
  "refunded_quantity",
  "discount_allocations",
  "discount_applications",
  "delivery_method",
  "fees",
  "payment_terms",
  "total_duties",
  "total_tip",
  "transactions",
  "shopify_store_credit",
  "routes.account_profile_url",
  "unit_price_measurement",
  "gift_card",
  "shopify-shop-marketplace-footer",
] as const;

/**
 * Liquid tokens that must exist in BOTH payment-method-update original + Mileyo.
 * Critical CTA: email_confirmation_url (never replace with portal / shop URL).
 */
export const PAYMENT_METHOD_UPDATE_CRITICAL_LIQUID_TOKENS = [
  "email_title",
  "email_greeting",
  "email_body",
  "display_name",
  "shop.name",
  "email_confirmation_url",
  "shopify-shop-marketplace-footer",
] as const;

export const checklistForNotification = (
  id: string,
): readonly string[] => {
  if (id === "payment-method-update") return PAYMENT_METHOD_UPDATE_CHECKLIST;
  if (id === "refund") return REFUND_CHECKLIST;
  if (id === "order-cancelled") return ORDER_CANCELLED_CHECKLIST;
  if (id === "delivered") return DELIVERED_CHECKLIST;
  if (id === "out-for-delivery") return OUT_FOR_DELIVERY_CHECKLIST;
  if (id === "shipping-update") return SHIPPING_UPDATE_CHECKLIST;
  if (id === "shipping-confirmation") return SHIPPING_CONFIRMATION_CHECKLIST;
  return ORDER_CONFIRMATION_CHECKLIST;
};
