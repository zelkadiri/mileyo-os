import { useEffect, useMemo, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";

import {
  SUBSCRIPTION_OBJECTIVES,
  type SubscriptionObjective,
} from "../../constants/subscriptionObjective";
import {
  CREATE_MEAL_INTENT,
  MEAL_CREATE_IMAGE_SCOPE_MESSAGE,
  createEmptyMealCreateFormValues,
  nutritionFieldName,
  objectiveLabel,
  type MealCreateFormValues,
  type MealCreateNutritionFields,
} from "./meals-create-form";
import {
  MEAL_IMAGE_SCOPE_DECLINED_MESSAGE,
  MEAL_IMAGE_SCOPE_UNAVAILABLE_MESSAGE,
  getShopifyAppBridgeScopesApi,
  reloadEmbeddedAdminAfterScopeChange,
  requestMealImageWriteFilesScope,
} from "./meals-create-image-scopes";
import type {
  CreateMealPageLoaderData,
  CreateMealResult,
} from "./meals-create.server";
import {
  MEALS_CREATE_STYLE_TAG,
  errorBannerStyle,
  errorTextStyle,
  noticeBoxStyle,
  successBannerStyle,
  warningBannerStyle,
} from "./meals-create-styles";

type LoaderData = CreateMealPageLoaderData;
type ActionData = CreateMealResult;

const NUTRITION_REQUIRED: Array<{
  key: keyof MealCreateNutritionFields;
  label: string;
}> = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "proteins", label: "Protéines (g)" },
  { key: "carbs", label: "Glucides (g)" },
  { key: "fat", label: "Lipides (g)" },
  { key: "portionGrams", label: "Poids de la portion (g)" },
];

const NUTRITION_OPTIONAL: Array<{
  key: keyof MealCreateNutritionFields;
  label: string;
}> = [
  { key: "saturatedFat", label: "Graisses saturées (g)" },
  { key: "sugars", label: "Sucres (g)" },
  { key: "fiber", label: "Fibres (g)" },
  { key: "salt", label: "Sel (g)" },
];

function FieldError({
  errors,
  field,
}: {
  errors: { field: string; message: string }[];
  field: string;
}) {
  const match = errors.find((error) => error.field === field);
  if (!match) return null;
  return (
    <p className="meals-create-error-text" style={errorTextStyle}>
      {match.message}
    </p>
  );
}

function NutritionPanel({
  objective,
  values,
  fieldErrors,
  disabled,
}: {
  objective: SubscriptionObjective;
  values: MealCreateNutritionFields;
  fieldErrors: { field: string; message: string }[];
  disabled: boolean;
}) {
  return (
    <div className="meals-create-section-stack">
      <div className="meals-create-nutrition-group">
        <p className="meals-create-nutrition-group-title">Valeurs principales</p>
        <p className="meals-create-nutrition-group-hint">
          Valeurs pour une portion
        </p>
        <div className="meals-create-nutrition-grid">
          {NUTRITION_REQUIRED.map((field) => {
            const name = nutritionFieldName(objective, field.key);
            return (
              <label key={name} className="meals-create-field" htmlFor={name}>
                <span className="meals-create-label">
                  {field.label}{" "}
                  <span className="meals-create-label-hint">*</span>
                </span>
                <input
                  className="meals-create-input"
                  defaultValue={values[field.key]}
                  disabled={disabled}
                  id={name}
                  inputMode="decimal"
                  name={name}
                  type="text"
                />
                <FieldError errors={fieldErrors} field={name} />
              </label>
            );
          })}
        </div>
      </div>

      <div className="meals-create-nutrition-optional">
        <p className="meals-create-nutrition-group-title">
          Informations complémentaires
        </p>
        <p className="meals-create-nutrition-group-hint">Facultatif</p>
        <div className="meals-create-nutrition-grid">
          {NUTRITION_OPTIONAL.map((field) => {
            const name = nutritionFieldName(objective, field.key);
            return (
              <label key={name} className="meals-create-field" htmlFor={name}>
                <span className="meals-create-label">{field.label}</span>
                <input
                  className="meals-create-input"
                  defaultValue={values[field.key]}
                  disabled={disabled}
                  id={name}
                  inputMode="decimal"
                  name={name}
                  type="text"
                />
                <FieldError errors={fieldErrors} field={name} />
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MealsCreatePage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === CREATE_MEAL_INTENT;

  const formValues: MealCreateFormValues =
    actionData?.values ?? createEmptyMealCreateFormValues();

  const fieldErrors = actionData?.fieldErrors ?? [];
  const [activeObjective, setActiveObjective] = useState<SubscriptionObjective>(
    SUBSCRIPTION_OBJECTIVES[0],
  );
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [photoScopeBusy, setPhotoScopeBusy] = useState(false);
  const [photoScopeNotice, setPhotoScopeNotice] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const catalogHint = useMemo(
    () =>
      `${loaderData.catalogCount} / ${loaderData.catalogLimit} plats dans le catalogue`,
    [loaderData.catalogCount, loaderData.catalogLimit],
  );

  const formDisabled = isSubmitting || !loaderData.canCreate;

  const handleRequestPhotoScope = async () => {
    if (photoScopeBusy || revalidator.state === "loading") return;
    setPhotoScopeBusy(true);
    setPhotoScopeNotice(null);
    try {
      const outcome = await requestMealImageWriteFilesScope(
        getShopifyAppBridgeScopesApi(),
      );
      if (outcome.kind === "granted" || outcome.kind === "already_granted") {
        // Document reload → bounce / token exchange. Soft revalidate after
        // scopes.request can surface HTTP 401 Unauthorized (stale ID token).
        reloadEmbeddedAdminAfterScopeChange();
        return;
      }
      if (outcome.kind === "declined") {
        setPhotoScopeNotice(MEAL_IMAGE_SCOPE_DECLINED_MESSAGE);
        return;
      }
      if (outcome.kind === "unavailable") {
        setPhotoScopeNotice(MEAL_IMAGE_SCOPE_UNAVAILABLE_MESSAGE);
        return;
      }
      setPhotoScopeNotice(outcome.message);
    } finally {
      setPhotoScopeBusy(false);
    }
  };

  return (
    <s-page heading="Créer un plat">
      <style>{MEALS_CREATE_STYLE_TAG}</style>
      <div className="meals-create-shell">
        <s-stack gap="large">
          <div className="meals-create-section-stack">
            <p className="meals-create-intro">
              Ajoutez une nouvelle recette au catalogue repas Mileyo. Les
              portions Perte de poids, Équilibré et Prise de masse sont créées
              automatiquement.
            </p>
            <p className="meals-create-meta">{catalogHint}</p>
          </div>

          {loaderData.createBlockedReason ? (
            <div
              className="meals-create-banner meals-create-banner--warning"
              role="status"
              style={warningBannerStyle}
            >
              <s-stack gap="base">
                <s-text>{loaderData.createBlockedReason}</s-text>
                <Link to="/app/settings">Ouvrir les réglages</Link>
              </s-stack>
            </div>
          ) : null}

          {actionData?.ok ? (
            <div
              className="meals-create-banner meals-create-banner--success"
              role="status"
              style={successBannerStyle}
            >
              <s-stack gap="base">
                <s-text>{actionData.message}</s-text>
                {actionData.blockedFieldNotices.length > 0 ? (
                  <s-unordered-list>
                    {actionData.blockedFieldNotices.map((notice) => (
                      <s-list-item key={notice}>{notice}</s-list-item>
                    ))}
                  </s-unordered-list>
                ) : null}
                <Link to="/app/settings">Retour au catalogue (Réglages)</Link>
              </s-stack>
            </div>
          ) : null}

          {actionData && !actionData.ok && actionData.errors.length > 0 ? (
            <div
              className="meals-create-banner meals-create-banner--error"
              role="alert"
              style={errorBannerStyle}
            >
              <s-stack gap="base">
                <s-text>{actionData.message}</s-text>
                <s-unordered-list>
                  {actionData.errors.map((error) => (
                    <s-list-item key={error}>{error}</s-list-item>
                  ))}
                </s-unordered-list>
                {actionData.trackingProductId ? (
                  <s-text>
                    Une création incomplète est conservée hors catalogue. Un
                    nouvel essai reprendra ce brouillon sans créer de doublon.
                  </s-text>
                ) : null}
              </s-stack>
            </div>
          ) : null}

          {!loaderData.imageUploadAvailable ? (
            <div className="meals-create-notice" style={noticeBoxStyle}>
              <s-stack gap="base">
                <s-text>{MEAL_CREATE_IMAGE_SCOPE_MESSAGE}</s-text>
                {photoScopeNotice ? (
                  <div
                    className="meals-create-banner meals-create-banner--warning"
                    role="status"
                    style={warningBannerStyle}
                  >
                    <s-text>{photoScopeNotice}</s-text>
                  </div>
                ) : null}
                <s-button
                  disabled={
                    photoScopeBusy || revalidator.state === "loading"
                      ? true
                      : undefined
                  }
                  onClick={() => {
                    void handleRequestPhotoScope();
                  }}
                  type="button"
                >
                  {photoScopeBusy || revalidator.state === "loading"
                    ? "Autorisation en cours…"
                    : "Autoriser l’ajout de photos"}
                </s-button>
              </s-stack>
            </div>
          ) : null}

          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value={CREATE_MEAL_INTENT} />
            <input
              type="hidden"
              name="createAttemptId"
              value={formValues.createAttemptId}
            />
            <input
              type="hidden"
              name="resumeProductId"
              value={formValues.resumeProductId}
            />

            <s-stack gap="large">
              <s-section heading="Informations générales">
                <div className="meals-create-section-stack">
                  <label className="meals-create-field" htmlFor="meal-title">
                    <span className="meals-create-label">
                      Nom du plat{" "}
                      <span className="meals-create-label-hint">*</span>
                    </span>
                    <input
                      className="meals-create-input"
                      defaultValue={formValues.title}
                      disabled={formDisabled}
                      id="meal-title"
                      name="title"
                      required
                      type="text"
                    />
                    <FieldError errors={fieldErrors} field="title" />
                  </label>

                  <label
                    className="meals-create-field"
                    htmlFor="meal-description"
                  >
                    <span className="meals-create-label">
                      Description{" "}
                      <span className="meals-create-label-hint">
                        (facultatif)
                      </span>
                    </span>
                    <textarea
                      className="meals-create-textarea"
                      defaultValue={formValues.description}
                      disabled={formDisabled}
                      id="meal-description"
                      name="description"
                    />
                  </label>

                  {loaderData.imageUploadAvailable ? (
                    <label className="meals-create-field" htmlFor="meal-image">
                      <span className="meals-create-label">
                        Image principale{" "}
                        <span className="meals-create-label-hint">
                          (facultatif)
                        </span>
                      </span>
                      <input
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="meals-create-file"
                        disabled={formDisabled}
                        id="meal-image"
                        name="image"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0] ?? null;
                          if (imagePreviewUrl) {
                            URL.revokeObjectURL(imagePreviewUrl);
                          }
                          if (file) {
                            setImagePreviewUrl(URL.createObjectURL(file));
                          } else {
                            setImagePreviewUrl(null);
                          }
                        }}
                        type="file"
                      />
                      <FieldError errors={fieldErrors} field="image" />
                      {imagePreviewUrl ? (
                        <img
                          alt="Aperçu du plat"
                          className="meals-create-preview"
                          src={imagePreviewUrl}
                        />
                      ) : null}
                    </label>
                  ) : (
                    <s-text>
                      Photo : non disponible tant que l’autorisation n’est pas
                      accordée (bouton ci-dessus).
                    </s-text>
                  )}

                  <label
                    className="meals-create-field"
                    htmlFor="meal-ingredients"
                  >
                    <span className="meals-create-label">
                      Ingrédients{" "}
                      <span className="meals-create-label-hint">
                        (facultatif)
                      </span>
                    </span>
                    <textarea
                      className="meals-create-textarea"
                      defaultValue={formValues.ingredients}
                      disabled={formDisabled}
                      id="meal-ingredients"
                      name="ingredients"
                      placeholder="Ex. poulet, riz, épices"
                    />
                  </label>

                  <label
                    className="meals-create-field"
                    htmlFor="meal-allergenes"
                  >
                    <span className="meals-create-label">
                      Allergènes{" "}
                      <span className="meals-create-label-hint">
                        (facultatif)
                      </span>
                    </span>
                    <textarea
                      className="meals-create-textarea"
                      defaultValue={formValues.allergenes}
                      disabled={formDisabled}
                      id="meal-allergenes"
                      name="allergenes"
                      placeholder="Ex. gluten, lait"
                    />
                  </label>

                  <div className="meals-create-badge-grid">
                    <label className="meals-create-field" htmlFor="meal-badge1">
                      <span className="meals-create-label">
                        Badge 1{" "}
                        <span className="meals-create-label-hint">
                          (facultatif)
                        </span>
                      </span>
                      <input
                        className="meals-create-input"
                        defaultValue={formValues.badge1}
                        disabled={formDisabled}
                        id="meal-badge1"
                        name="badge1"
                        type="text"
                      />
                    </label>
                    <label className="meals-create-field" htmlFor="meal-badge2">
                      <span className="meals-create-label">
                        Badge 2{" "}
                        <span className="meals-create-label-hint">
                          (facultatif)
                        </span>
                      </span>
                      <input
                        className="meals-create-input"
                        defaultValue={formValues.badge2}
                        disabled={formDisabled}
                        id="meal-badge2"
                        name="badge2"
                        type="text"
                      />
                    </label>
                    <label className="meals-create-field" htmlFor="meal-badge3">
                      <span className="meals-create-label">
                        Badge 3{" "}
                        <span className="meals-create-label-hint">
                          (facultatif)
                        </span>
                      </span>
                      <input
                        className="meals-create-input"
                        defaultValue={formValues.badge3}
                        disabled={formDisabled}
                        id="meal-badge3"
                        name="badge3"
                        type="text"
                      />
                    </label>
                  </div>
                </div>
              </s-section>

              <s-section heading="Nutrition">
                <div className="meals-create-section-stack">
                  <p className="meals-create-intro">
                    Renseignez les valeurs pour chaque objectif. Les saisies
                    restent mémorisées lorsque vous changez d’onglet.
                  </p>

                  <div
                    aria-label="Objectif nutritionnel"
                    className="meals-create-tablist"
                    role="tablist"
                  >
                    {SUBSCRIPTION_OBJECTIVES.map((objective) => (
                      <button
                        key={objective}
                        aria-controls={`nutrition-panel-${objective}`}
                        aria-selected={activeObjective === objective}
                        className="meals-create-tab"
                        disabled={formDisabled}
                        id={`nutrition-tab-${objective}`}
                        onClick={() => setActiveObjective(objective)}
                        role="tab"
                        type="button"
                      >
                        {objectiveLabel(objective)}
                      </button>
                    ))}
                  </div>

                  {/* Keep all objective fields mounted so tab switches preserve values. */}
                  {SUBSCRIPTION_OBJECTIVES.map((objective) => (
                    <div
                      key={objective}
                      aria-labelledby={`nutrition-tab-${objective}`}
                      hidden={activeObjective !== objective}
                      id={`nutrition-panel-${objective}`}
                      role="tabpanel"
                    >
                      <NutritionPanel
                        disabled={formDisabled}
                        fieldErrors={fieldErrors}
                        objective={objective}
                        values={formValues.nutrition[objective]}
                      />
                    </div>
                  ))}
                </div>
              </s-section>

              <s-section heading="Création">
                <div className="meals-create-actions">
                  <div className="meals-create-actions-primary">
                    <s-button disabled={formDisabled} type="submit">
                      {isSubmitting ? "Création en cours…" : "Créer le plat"}
                    </s-button>
                  </div>
                  <div className="meals-create-actions-cancel">
                    <Link to="/app/settings">Annuler</Link>
                  </div>
                </div>
              </s-section>
            </s-stack>
          </Form>
        </s-stack>
      </div>
    </s-page>
  );
}
