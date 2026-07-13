import { Form, useLoaderData } from "react-router";

import {
  formatDeliveryDateLabel,
  parseDeliveryDate,
} from "../../utils/deliveryDate";
import {
  downloadPreparationDeliveryOrdersCsv,
  downloadPreparationProductionCsv,
} from "./preparation-csv";
import type { loadPreparationPageData } from "./preparation-data.server";
import {
  formatPreparationOrderTypeLabel,
  formatPreparationRescheduleReason,
} from "./preparation-formatters";
import {
  chipLinkStyle,
  chipRowStyle,
  cutoffBadgeStyle,
  cutoffChipDotStyle,
  dateInputStyle,
  datePickerRowStyle,
  emptyStateStyle,
  exportButtonStyle,
  introStyle,
  listStyle,
  mealQuantityStyle,
  mealRowStyle,
  mealTitleStyle,
  orderMetaStyle,
  productionHeadingStyle,
  productionSectionStyle,
  secondaryButtonStyle,
  summaryCardStyle,
  summaryGridStyle,
  summaryLabelStyle,
  summaryValueStyle,
  warningBannerStyle,
} from "./preparation-styles";

type PreparationPageData = Awaited<ReturnType<typeof loadPreparationPageData>>;

export default function PreparationPage() {
  const { dateQueryInvalid, dayData, selectedCutoff, selectedDate, upcomingDates } =
    useLoaderData<PreparationPageData>();
  const summary = dayData?.summary ?? null;
  const hasOrders = (summary?.totalOrders ?? 0) > 0;
  const hasMeals = (summary?.totalMeals ?? 0) > 0;

  return (
    <s-page heading="Préparation">
      <s-section>
        <s-stack gap="base">
          <p style={introStyle}>
            Organisez les plats à préparer par date de livraison.
          </p>

          {dateQueryInvalid ? (
            <p style={warningBannerStyle}>
              Date invalide dans l’URL. Utilisez le format AAAA-MM-JJ.
            </p>
          ) : null}

          <div style={datePickerRowStyle}>
            <Form method="get">
              <label>
                <span className="visually-hidden">Date de livraison</span>
                <input
                  defaultValue={selectedDate ?? ""}
                  name="date"
                  onChange={(event) => {
                    event.currentTarget.form?.requestSubmit();
                  }}
                  style={dateInputStyle}
                  type="date"
                />
              </label>
            </Form>

            {upcomingDates.length > 0 ? (
              <div style={chipRowStyle}>
                {upcomingDates.map((entry) => (
                  <a
                    href={`/app/preparation?date=${encodeURIComponent(entry.scheduledDeliveryDate)}`}
                    key={entry.scheduledDeliveryDate}
                    style={chipLinkStyle(
                      selectedDate === entry.scheduledDeliveryDate,
                    )}
                  >
                    {formatDeliveryDateLabel(entry.scheduledDeliveryDate, {
                      short: true,
                    })}{" "}
                    ({entry.orderCount})
                    {entry.cutoff?.isKnown ? (
                      <span
                        aria-label={
                          entry.cutoff.isPassed
                            ? "Cutoff passé"
                            : "Modifications ouvertes"
                        }
                        style={cutoffChipDotStyle(
                          entry.cutoff.isPassed ? "closed" : "open",
                        )}
                      />
                    ) : null}
                  </a>
                ))}
              </div>
            ) : (
              <s-text>Aucune livraison planifiée pour le moment.</s-text>
            )}
          </div>

          {selectedDate && summary ? (
            <>
              <s-box borderRadius="base" borderWidth="base" padding="base">
                <s-stack gap="small">
                  <s-text>
                    <strong>
                      Livraison prévue :{" "}
                      {formatDeliveryDateLabel(selectedDate)}
                    </strong>
                  </s-text>
                  {selectedCutoff?.isKnown ? (
                    <div>
                      {selectedCutoff.isPassed ? (
                        <span style={cutoffBadgeStyle("closed")}>
                          Cutoff passé — cette livraison est en préparation
                        </span>
                      ) : selectedCutoff.deadlineLabel ? (
                        <span style={cutoffBadgeStyle("open")}>
                          Modifications ouvertes jusqu’au{" "}
                          {selectedCutoff.deadlineLabel}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={summaryGridStyle}>
                    <div style={summaryCardStyle}>
                      <p style={summaryLabelStyle}>Commandes</p>
                      <p style={summaryValueStyle}>{summary.totalOrders}</p>
                    </div>
                    <div style={summaryCardStyle}>
                      <p style={summaryLabelStyle}>Repas à préparer</p>
                      <p style={summaryValueStyle}>{summary.totalMeals}</p>
                    </div>
                    <div style={summaryCardStyle}>
                      <p style={summaryLabelStyle}>Abonnements</p>
                      <p style={summaryValueStyle}>
                        {summary.subscriptionOrders}
                      </p>
                    </div>
                    <div style={summaryCardStyle}>
                      <p style={summaryLabelStyle}>Commandes uniques</p>
                      <p style={summaryValueStyle}>{summary.oneTimeOrders}</p>
                    </div>
                    <div style={summaryCardStyle}>
                      <p style={summaryLabelStyle}>Reports</p>
                      <p style={summaryValueStyle}>
                        {summary.rescheduledOrders}
                      </p>
                    </div>
                  </div>
                </s-stack>
              </s-box>

              <div style={productionSectionStyle}>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.75rem",
                    justifyContent: "space-between",
                    marginBottom: "1rem",
                  }}
                >
                  <h2 style={productionHeadingStyle}>À préparer</h2>
                  <button
                    disabled={!dayData}
                    onClick={() => {
                      if (dayData) {
                        downloadPreparationProductionCsv(dayData);
                      }
                    }}
                    style={exportButtonStyle}
                    type="button"
                  >
                    Exporter production CSV
                  </button>
                </div>

                {!hasOrders ? (
                  <p style={emptyStateStyle}>
                    Aucune livraison prévue pour cette date.
                  </p>
                ) : !hasMeals ? (
                  <p style={emptyStateStyle}>
                    Aucun plat à préparer pour cette date.
                  </p>
                ) : (
                  dayData?.mealTotals.map((meal) => (
                    <div key={meal.mealTitle} style={mealRowStyle}>
                      <p style={mealTitleStyle}>{meal.mealTitle}</p>
                      <p style={mealQuantityStyle}>x{meal.totalQuantity}</p>
                    </div>
                  ))
                )}
              </div>

              <s-section heading="Commandes de cette livraison">
                <s-stack gap="base">
                  <button
                    disabled={!dayData}
                    onClick={() => {
                      if (dayData) {
                        downloadPreparationDeliveryOrdersCsv(dayData);
                      }
                    }}
                    style={secondaryButtonStyle}
                    type="button"
                  >
                    Exporter commandes CSV
                  </button>

                  {!hasOrders ? (
                    <p style={emptyStateStyle}>
                      Aucune livraison prévue pour cette date.
                    </p>
                  ) : (
                    dayData?.orders.map((order) => {
                      const rescheduleLabel = formatPreparationRescheduleReason(
                        order.deliveryRescheduleReason,
                      );

                      return (
                        <s-box
                          key={order.id}
                          borderRadius="base"
                          borderWidth="base"
                          padding="base"
                        >
                          <s-stack gap="small">
                            <s-text>
                              <strong>
                                {order.orderName ?? "Commande sans numéro"}
                              </strong>
                            </s-text>
                            <p style={orderMetaStyle}>
                              Client : {order.customerName ?? "Non renseigné"}
                              {order.customerEmail
                                ? ` (${order.customerEmail})`
                                : ""}
                            </p>
                            <p style={orderMetaStyle}>
                              Type :{" "}
                              {formatPreparationOrderTypeLabel(order.orderType)}
                            </p>
                            <p style={orderMetaStyle}>
                              Box : {order.boxTitle ?? "Non renseignée"}
                            </p>
                            <p style={orderMetaStyle}>
                              Nombre de repas :{" "}
                              {order.mealsCount ?? "Non renseigné"}
                            </p>
                            <p style={orderMetaStyle}>
                              Date souhaitée :{" "}
                              {(() => {
                                const desiredDate = parseDeliveryDate(
                                  order.desiredDeliveryDate,
                                );

                                return desiredDate
                                  ? formatDeliveryDateLabel(desiredDate, {
                                      short: true,
                                    })
                                  : "—";
                              })()}
                            </p>
                            <p style={orderMetaStyle}>
                              Date prévue :{" "}
                              {formatDeliveryDateLabel(
                                order.scheduledDeliveryDate,
                                { short: true },
                              )}
                            </p>
                            {rescheduleLabel ? (
                              <p style={orderMetaStyle}>
                                Report : {rescheduleLabel}
                              </p>
                            ) : null}
                            <s-text>Plats :</s-text>
                            {order.selectedMeals.length > 0 ? (
                              <ul style={listStyle}>
                                {order.selectedMeals.map((meal, index) => (
                                  <li key={`${order.id}-${meal}-${index}`}>
                                    {meal}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p style={emptyStateStyle}>Aucun plat trouvé.</p>
                            )}
                          </s-stack>
                        </s-box>
                      );
                    })
                  )}
                </s-stack>
              </s-section>
            </>
          ) : dateQueryInvalid ? (
            <p style={emptyStateStyle}>
              Sélectionnez une date valide pour afficher la préparation.
            </p>
          ) : (
            <p style={emptyStateStyle}>
              Aucune livraison prévue pour cette date.
            </p>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
