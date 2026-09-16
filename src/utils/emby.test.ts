// @vitest-environment jsdom

import { beforeEach, expect, it } from "vitest"
import { getEmbyDeviceID } from "./emby"

beforeEach(() => localStorage.clear())

it("persists a Mahiro device ID without reusing the OpenList identity", () => {
  localStorage.setItem("openlist_emby_device_id", "openlist-web-old-device")

  const deviceID = getEmbyDeviceID()

  expect(deviceID).toMatch(/^mahiro-web-/)
  expect(localStorage.getItem("mahiro_emby_device_id")).toBe(deviceID)
  expect(getEmbyDeviceID()).toBe(deviceID)
})
