import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Field, InfoTooltip, Select } from "../components/ui";

describe("InfoTooltip", () => {
  it("opens and closes a plain-language explanation", () => {
    const explanation = "The minimum annual savings required before switching.";
    const { getByLabelText, getByText, queryByText } = render(
      <InfoTooltip label="Minimum savings" text={explanation} />,
    );

    fireEvent.press(getByLabelText("About Minimum savings"));
    expect(getByText(explanation)).toBeTruthy();

    fireEvent.press(getByLabelText("Close Minimum savings explanation"));
    expect(queryByText(explanation)).toBeNull();
  });

  it("adds help controls to fields without changing the input label", () => {
    const { getByLabelText } = render(
      <Field
        label="Liability amount"
        helpText="The third-party liability limit."
        value="2000000"
        onChangeText={() => undefined}
      />,
    );

    expect(getByLabelText("Liability amount")).toBeTruthy();
    expect(getByLabelText("About Liability amount")).toBeTruthy();
  });

  it("keeps select help separate from opening the choices", () => {
    const { getByLabelText, queryByText } = render(
      <Select
        label="Coverage preference"
        helpText="Required means a quote must include this coverage."
        options={[
          { value: "required", label: "Required" },
          { value: "preferred", label: "Preferred" },
        ]}
        value="required"
        onValueChange={() => undefined}
      />,
    );

    fireEvent.press(getByLabelText("About Coverage preference"));
    expect(queryByText("Preferred")).toBeNull();
    fireEvent.press(getByLabelText("Close Coverage preference explanation"));

    fireEvent.press(getByLabelText("Coverage preference"));
    expect(queryByText("Preferred")).toBeTruthy();
  });
});
