/**
 * UI styles for « Créer un plat ».
 * Responsive via container queries (embedded Shopify Admin width) +
 * viewport fallbacks. No new UI library.
 */

export const MEALS_CREATE_STYLE_TAG = `
.meals-create-shell {
  box-sizing: border-box;
  container-type: inline-size;
  container-name: meals-create;
  max-width: 52rem;
  min-width: 0;
  overflow-x: clip;
  width: 100%;
}

.meals-create-shell *,
.meals-create-shell *::before,
.meals-create-shell *::after {
  box-sizing: border-box;
}

.meals-create-intro {
  color: #4a4a4a;
  line-height: 1.45;
  margin: 0;
}

.meals-create-meta {
  color: #6d7175;
  font-size: 0.9rem;
  margin: 0;
}

.meals-create-section-stack {
  display: grid;
  gap: 1.1rem;
  min-width: 0;
}

.meals-create-field {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}

.meals-create-label {
  color: #202223;
  font-size: 0.92rem;
  font-weight: 600;
  line-height: 1.3;
}

.meals-create-label-hint {
  color: #6d7175;
  font-size: 0.85rem;
  font-weight: 400;
}

.meals-create-input,
.meals-create-textarea {
  -webkit-appearance: none;
  appearance: none;
  background: #ffffff;
  border: 1px solid #c9cccf;
  border-radius: 0.5rem;
  color: #202223;
  font: inherit;
  max-width: 100%;
  min-height: 2.75rem;
  min-width: 0;
  padding: 0.7rem 0.85rem;
  width: 100%;
}

.meals-create-input:focus,
.meals-create-textarea:focus,
.meals-create-tab:focus-visible {
  border-color: #1a1a1a;
  outline: 2px solid #1a1a1a;
  outline-offset: 2px;
}

.meals-create-input:disabled,
.meals-create-textarea:disabled,
.meals-create-tab:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.meals-create-textarea {
  min-height: 5.75rem;
  resize: vertical;
}

.meals-create-file {
  font: inherit;
  max-width: 100%;
  min-width: 0;
  width: 100%;
}

.meals-create-preview {
  background: #f6f6f7;
  border: 1px solid #e1e3e5;
  border-radius: 0.75rem;
  display: block;
  height: auto;
  margin-top: 0.65rem;
  max-height: 14rem;
  max-width: min(100%, 18rem);
  object-fit: cover;
  width: 100%;
}

.meals-create-badge-grid,
.meals-create-nutrition-grid {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  width: 100%;
}

.meals-create-nutrition-group {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.meals-create-nutrition-group-title {
  color: #202223;
  font-size: 0.95rem;
  font-weight: 650;
  margin: 0;
}

.meals-create-nutrition-group-hint {
  color: #6d7175;
  font-size: 0.85rem;
  margin: 0;
}

.meals-create-nutrition-optional {
  background: #fafbfb;
  border: 1px solid #e4e5e7;
  border-radius: 0.75rem;
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.9rem;
}

.meals-create-tablist {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 0.35rem;
  min-width: 0;
  width: 100%;
}

.meals-create-tab {
  background: #ffffff;
  border: 1px solid #c9cccf;
  border-radius: 999px;
  color: #202223;
  cursor: pointer;
  flex: 1 1 calc(50% - 0.5rem);
  font: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  min-height: 2.75rem;
  min-width: 0;
  padding: 0.55rem 0.9rem;
  text-align: center;
}

.meals-create-tab[aria-selected="true"] {
  background: #1a1a1a;
  border-color: #1a1a1a;
  color: #ffffff;
}

.meals-create-actions {
  align-items: stretch;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 0.25rem;
  min-width: 0;
  width: 100%;
}

.meals-create-actions-primary {
  width: 100%;
}

.meals-create-actions-cancel {
  align-self: center;
}

.meals-create-banner {
  border-radius: 0.75rem;
  padding: 0.9rem 1rem;
}

.meals-create-banner--warning {
  background: #fef3c7;
  color: #92400e;
}

.meals-create-banner--success {
  background: #dcfce7;
  color: #166534;
}

.meals-create-banner--error {
  background: #fee2e2;
  color: #991b1b;
}

.meals-create-notice {
  background: #f7f7f7;
  border: 1px solid #e1e3e5;
  border-radius: 0.75rem;
  padding: 0.9rem 1rem;
}

.meals-create-error-text {
  color: #b91c1c;
  font-size: 0.88rem;
  margin: 0;
}

@container meals-create (min-width: 420px) {
  .meals-create-tab {
    flex: 1 1 0;
  }

  .meals-create-badge-grid,
  .meals-create-nutrition-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container meals-create (min-width: 640px) {
  .meals-create-nutrition-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .meals-create-actions {
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .meals-create-actions-primary {
    width: auto;
    min-width: 11rem;
  }

  .meals-create-actions-cancel {
    align-self: auto;
  }
}

/* Viewport fallback when container queries are unavailable / parent not sized. */
@media (min-width: 480px) {
  .meals-create-badge-grid,
  .meals-create-nutrition-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .meals-create-tab {
    flex: 1 1 0;
  }
}

@media (min-width: 768px) {
  .meals-create-nutrition-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .meals-create-actions {
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
  }

  .meals-create-actions-primary {
    width: auto;
    min-width: 11rem;
  }
}
`;

/** @deprecated Prefer className meals-create-* — kept for any residual imports. */
export const fieldStyle = {
  display: "grid",
  gap: "0.4rem",
  minWidth: 0,
} as const;

export const textInputStyle = {
  border: "1px solid #c9cccf",
  borderRadius: "0.5rem",
  font: "inherit",
  maxWidth: "100%",
  minWidth: 0,
  padding: "0.7rem 0.85rem",
  width: "100%",
} as const;

export const textAreaStyle = {
  ...textInputStyle,
  minHeight: "5.75rem",
  resize: "vertical" as const,
};

export const numberInputStyle = {
  ...textInputStyle,
} as const;

export const tabListStyle = {
  display: "flex",
  flexWrap: "wrap" as const,
  gap: "0.5rem",
  marginBottom: "0.35rem",
  minWidth: 0,
  width: "100%",
} as const;

export const tabButtonStyle = (active: boolean) =>
  ({
    background: active ? "#1a1a1a" : "#ffffff",
    border: `1px solid ${active ? "#1a1a1a" : "#c9cccf"}`,
    borderRadius: "999px",
    color: active ? "#ffffff" : "#202223",
    cursor: "pointer",
    flex: "1 1 0",
    font: "inherit",
    fontWeight: 600,
    minHeight: "2.75rem",
    minWidth: 0,
    padding: "0.55rem 0.9rem",
  }) as const;

export const nutritionGridStyle = {
  display: "grid",
  gap: "0.9rem",
  gridTemplateColumns: "minmax(0, 1fr)",
  minWidth: 0,
  width: "100%",
} as const;

export const previewImageStyle = {
  borderRadius: "0.75rem",
  display: "block",
  height: "auto",
  marginTop: "0.65rem",
  maxHeight: "14rem",
  maxWidth: "min(100%, 18rem)",
  objectFit: "cover" as const,
  width: "100%",
};

export const noticeBoxStyle = {
  background: "#f7f7f7",
  border: "1px solid #e1e3e5",
  borderRadius: "0.75rem",
  padding: "0.9rem 1rem",
} as const;

export const warningBannerStyle = {
  background: "#fef3c7",
  borderRadius: "0.75rem",
  color: "#92400e",
  padding: "0.9rem 1rem",
} as const;

export const successBannerStyle = {
  background: "#dcfce7",
  borderRadius: "0.75rem",
  color: "#166534",
  padding: "0.9rem 1rem",
} as const;

export const errorBannerStyle = {
  background: "#fee2e2",
  borderRadius: "0.75rem",
  color: "#991b1b",
  padding: "0.9rem 1rem",
} as const;

export const errorTextStyle = {
  color: "#b91c1c",
  fontSize: "0.88rem",
  margin: 0,
} as const;

export const actionsRowStyle = {
  alignItems: "stretch",
  display: "flex",
  flexDirection: "column" as const,
  flexWrap: "wrap" as const,
  gap: "0.85rem",
  marginTop: "0.25rem",
  width: "100%",
} as const;
