import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileDrop } from "../../../composables/useFileDrop.js";
import { uploadWallpaperFiles, WALLPAPER_ACCEPTED_EXTENSIONS } from "./wallpaperUpload.js";

function makeFile(name: string): File {
	return new File(["data"], name, { type: "application/octet-stream" });
}

function makeDragEvent(files: File[]): DragEvent {
	const dt = { files, types: ["Files"] } as unknown as DataTransfer;
	return { preventDefault: vi.fn(), dataTransfer: dt } as unknown as DragEvent;
}

describe("wallpaper upload drag and drop", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("uploads accepted dropped wallpaper files through the shared uploader", async () => {
		const image = makeFile("forest.PNG");
		const rejected = makeFile("notes.txt");
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
			Response.json({ filename: "forest.png" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const loadWallpapers = vi.fn(async () => {});
		const selectWallpaper = vi.fn(async () => {});
		const setUploadError = vi.fn();
		const uploadFiles = vi.fn((files: File[]) =>
			uploadWallpaperFiles(files, {
				token: "test-token",
				loadWallpapers,
				selectWallpaper,
				setUploadError,
			}),
		);

		const { onDrop } = useFileDrop(uploadFiles, WALLPAPER_ACCEPTED_EXTENSIONS);
		onDrop(makeDragEvent([image, rejected]));
		await (uploadFiles.mock.results[0]?.value as Promise<void>);

		expect(uploadFiles).toHaveBeenCalledOnce();
		expect(uploadFiles.mock.calls[0]?.[0]).toEqual([image]);
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/wallpapers");
		expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
			method: "POST",
			headers: { Authorization: "Bearer test-token" },
		});
		expect(loadWallpapers).toHaveBeenCalledOnce();
		expect(selectWallpaper).toHaveBeenCalledWith("forest.png");
		expect(setUploadError).toHaveBeenLastCalledWith("");
	});

	it("does not call the shared uploader for non-wallpaper drops", () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const uploadFiles = vi.fn();

		const { onDrop } = useFileDrop(uploadFiles, WALLPAPER_ACCEPTED_EXTENSIONS);
		onDrop(makeDragEvent([makeFile("archive.zip"), makeFile("readme.md")]));

		expect(uploadFiles).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
