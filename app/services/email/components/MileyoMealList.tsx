import * as React from "react";
import { Text } from "react-email";

import { mileyoEmailColors, mileyoEmailTextStyle } from "./mileyoEmailTokens";

export type MileyoMealListProps = {
  meals: string[];
  heading?: string;
};

/**
 * Simple meal name list for confirmation / upcoming delivery emails.
 */
export const MileyoMealList = ({
  meals,
  heading = "Vos repas",
}: MileyoMealListProps) => {
  const cleaned = meals.map((meal) => meal.trim()).filter(Boolean);

  if (cleaned.length === 0) {
    return null;
  }

  return (
    <>
      <Text style={headingStyle}>{heading}</Text>
      <Text style={list} aria-label={heading}>
        {cleaned.map((meal, index) => (
          <span key={`${meal}-${index}`}>
            {index > 0 ? <br /> : null}• {meal}
          </span>
        ))}
      </Text>
    </>
  );
};

const headingStyle: React.CSSProperties = {
  color: mileyoEmailColors.title,
  fontSize: "14px",
  fontWeight: 600,
  lineHeight: "20px",
  margin: "4px 0 8px",
};

const list: React.CSSProperties = {
  ...mileyoEmailTextStyle,
  margin: "0 0 16px",
};

export default MileyoMealList;
