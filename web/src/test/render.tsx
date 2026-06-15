import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export function renderWithApp(ui: ReactElement) {
  return render(ui);
}
