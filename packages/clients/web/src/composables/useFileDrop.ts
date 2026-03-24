
import { ref, type Ref } from "vue";


export function useFileDrop(
	onFiles: (files: File[]) => void,
	acceptedExtensions?: Set<string>,
): {
	isDragging: Ref<boolean>;
	onDragEnter: (e: DragEvent) => void;
	onDragOver: (e: DragEvent) => void;
	onDragLeave: (e: DragEvent) => void;
	onDrop: (e: DragEvent) => void;
} {
	const isDragging = ref(false);
	let enterCount = 0;

	function onDragEnter(e: DragEvent): void {
		e.preventDefault();
		if (e.dataTransfer?.types.includes("Files")) {
			enterCount++;
			isDragging.value = true;
		}
	}

	function onDragOver(e: DragEvent): void {
		e.preventDefault(); // Required for drop to work
	}

	function onDragLeave(_e: DragEvent): void {
		enterCount = Math.max(0, enterCount - 1);
		if (enterCount === 0) {
			isDragging.value = false;
		}
	}

	function onDrop(e: DragEvent): void {
		e.preventDefault();
		enterCount = 0;
		isDragging.value = false;

		const files = Array.from(e.dataTransfer?.files ?? []);
		const accepted = acceptedExtensions
			? files.filter((f) => {
					const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
					return acceptedExtensions.has(ext);
				})
			: files;

		if (accepted.length > 0) {
			onFiles(accepted);
		}
	}

	return { isDragging, onDragEnter, onDragOver, onDragLeave, onDrop };
}
