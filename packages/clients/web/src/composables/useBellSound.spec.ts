import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { playBellSound } from "./useBellSound.js";

describe("playBellSound", () => {
	describe("mute mode", () => {
		it("does nothing when sound is mute", () => {
			// Should not throw
			expect(() => playBellSound({ sound: "mute" })).not.toThrow();
		});
	});

	describe("custom sound — extension validation", () => {
		let mockAudio: { play: MockInstance; volume: number };
		let AudioSpy: MockInstance;
		let warnSpy: MockInstance;

		beforeEach(() => {
			mockAudio = { play: vi.fn().mockResolvedValue(undefined), volume: 0 };
			AudioSpy = vi
				// biome-ignore lint/suspicious/noExplicitAny: spying on the global Audio constructor with a partial test double; the real HTMLAudioElement ctor type does not match the mock and MockInstance<any> is needed to assign the spy
				.spyOn(globalThis, "Audio" as any)
				.mockReturnValue(mockAudio as never);
			warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		});

		afterEach(() => {
			AudioSpy.mockRestore();
			warnSpy.mockRestore();
		});

		it.each([".wav", ".mp3", ".ogg", ".m4a"])("accepts valid extension %s", (ext) => {
			playBellSound({ sound: "custom", customSoundFile: `bell${ext}` });
			expect(AudioSpy).toHaveBeenCalledWith(`/public/sounds/bell${ext}`);
			expect(warnSpy).not.toHaveBeenCalled();
		});

		it("rejects invalid extension and logs a warning", () => {
			playBellSound({ sound: "custom", customSoundFile: "bell.exe" });
			expect(AudioSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid audio extension"));
		});

		it("rejects extension-less filename and logs a warning", () => {
			playBellSound({ sound: "custom", customSoundFile: "bellfile" });
			expect(AudioSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid audio extension"));
		});

		it("rejects path traversal filename and does not play", () => {
			playBellSound({ sound: "custom", customSoundFile: "../sounds/bell.mp3" });
			// Path traversal guard fires before extension check — no Audio, no warn
			expect(AudioSpy).not.toHaveBeenCalled();
		});

		it("is case-insensitive for extension check", () => {
			playBellSound({ sound: "custom", customSoundFile: "BELL.MP3" });
			expect(AudioSpy).toHaveBeenCalledWith("/public/sounds/BELL.MP3");
			expect(warnSpy).not.toHaveBeenCalled();
		});
	});
});
