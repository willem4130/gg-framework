import { afterEach, describe, expect, it } from "vitest";
import { RADIO_STATIONS, getRadioVolume, setRadioVolume } from "./radio.js";

afterEach(() => {
  setRadioVolume(70);
});

describe("radio", () => {
  it("includes the verified SomaFM reggae stream", () => {
    expect(RADIO_STATIONS).toContainEqual(
      expect.objectContaining({
        id: "somafm-heavyweight-reggae",
        url: "https://ice5.somafm.com/reggae-128-mp3",
      }),
    );
  });

  it("clamps app-wide volume to whole percentages", () => {
    expect(setRadioVolume(-1).ok).toBe(true);
    expect(getRadioVolume()).toBe(0);
    setRadioVolume(55.6);
    expect(getRadioVolume()).toBe(56);
    setRadioVolume(101);
    expect(getRadioVolume()).toBe(100);
  });
});
