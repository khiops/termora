
import { describe, it, expect, vi } from "vitest";
import { useFontDrop } from "./useFontDrop.js";

function makeFile(name: string): File {
	return new File(["data"], name, { type: "application/octet-stream" });
}

function makeDragEvent(files: File[]): DragEvent {
	const dt = { files, types: ["Files"] } as unknown as DataTransfer;
	return { preventDefault: vi.fn(), dataTransfer: dt } as unknown as DragEvent;
}

describe("useFontDrop", () => {
	it("filters dropped files by accepted extensions", () => {
		const onFiles = vi.fn();
		const { onDrop } = useFontDrop(onFiles);

		onDrop(makeDragEvent([makeFile("font.ttf"), makeFile("image.png"), makeFile("font.woff2")]));

		expect(onFiles).toHaveBeenCalledOnce();
		const accepted = onFiles.mock.calls[0][0] as File[];
		expect(accepted).toHaveLength(2);
		expect(accepted[0].name).toBe("font.ttf");
		expect(accepted[1].name).toBe("font.woff2");
	});

	it("tracks isDragging state via dragenter/dragleave", () => {
		const { isDragging, onDragEnter, onDragLeave } = useFontDrop(vi.fn());

		expect(isDragging.value).toBe(false);
		onDragEnter({ preventDefault: vi.fn(), dataTransfer: { types: ["Files"] } } as unknown as DragEvent);
		expect(isDragging.value).toBe(true);
		onDragLeave({} as DragEvent);
		expect(isDragging.value).toBe(false);
	});

	it("does not call onFiles when no valid files are dropped", () => {
		const onFiles = vi.fn();
		const { onDrop } = useFontDrop(onFiles);

		onDrop(makeDragEvent([makeFile("readme.md")]));
		expect(onFiles).not.toHaveBeenCalled();
	});

	it("accepts all supported font extensions", () => {
		const onFiles = vi.fn();
		const { onDrop } = useFontDrop(onFiles);

		onDrop(
			makeDragEvent([makeFile("a.ttf"), makeFile("b.otf"), makeFile("c.woff"), makeFile("d.woff2")]),
		);

		expect(onFiles).toHaveBeenCalledOnce();
		const accepted = onFiles.mock.calls[0][0] as File[];
		expect(accepted).toHaveLength(4);
	});

	it("handles nested dragenter/dragleave pairs (counter)", () => {
		const { isDragging, onDragEnter, onDragLeave } = useFontDrop(vi.fn());
		const evt = { preventDefault: vi.fn(), dataTransfer: { types: ["Files"] } } as unknown as DragEvent;

		onDragEnter(evt);
		onDragEnter(evt); // nested child element
		expect(isDragging.value).toBe(true);
		onDragLeave({} as DragEvent);
		expect(isDragging.value).toBe(true); // still dragging
		onDragLeave({} as DragEvent);
		expect(isDragging.value).toBe(false);
	});

	it("resets isDragging on drop", () => {
		const { isDragging, onDragEnter, onDrop } = useFontDrop(vi.fn());
		const enterEvt = { preventDefault: vi.fn(), dataTransfer: { types: ["Files"] } } as unknown as DragEvent;

		onDragEnter(enterEvt);
		expect(isDragging.value).toBe(true);
		onDrop(makeDragEvent([makeFile("font.ttf")]));
		expect(isDragging.value).toBe(false);
	});

	it("ignores dragenter when no Files in types", () => {
		const { isDragging, onDragEnter } = useFontDrop(vi.fn());

		onDragEnter({ preventDefault: vi.fn(), dataTransfer: { types: ["text/plain"] } } as unknown as DragEvent);
		expect(isDragging.value).toBe(false);
	});

	it("prevents default on dragover", () => {
		const { onDragOver } = useFontDrop(vi.fn());
		const evt = { preventDefault: vi.fn() } as unknown as DragEvent;
		onDragOver(evt);
		expect(evt.preventDefault).toHaveBeenCalled();
	});
});
