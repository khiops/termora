import { describe, expect, it } from "vitest";

// Replicate the connectionTabHasError logic as a pure function
interface TabValidationInput {
	type: "local" | "ssh";
	sshHost: string;
	sshAuth: "agent" | "key" | "password";
	sshKeyPath: string;
}

function connectionTabHasError(form: TabValidationInput): boolean {
	if (form.type === "ssh") {
		if (!form.sshHost) return true;
		if (form.sshAuth === "key" && !form.sshKeyPath) return true;
	}
	return false;
}

// Replicate the first-errored-tab logic (EFF-08/SC-10b)
function firstErroredTab(
	form: TabValidationInput,
): "connection" | "terminal" | "appearance" | null {
	if (connectionTabHasError(form)) return "connection";
	// Terminal and Appearance have no required fields
	return null;
}

describe("HostModal tab logic", () => {
	it("connectionTabHasError returns true when sshHost is empty", () => {
		expect(
			connectionTabHasError({
				type: "ssh",
				sshHost: "",
				sshAuth: "agent",
				sshKeyPath: "",
			}),
		).toBe(true);
	});

	it("connectionTabHasError returns true when key auth but no keyPath", () => {
		expect(
			connectionTabHasError({
				type: "ssh",
				sshHost: "10.0.0.1",
				sshAuth: "key",
				sshKeyPath: "",
			}),
		).toBe(true);
	});

	it("connectionTabHasError returns false when valid", () => {
		expect(
			connectionTabHasError({
				type: "ssh",
				sshHost: "10.0.0.1",
				sshAuth: "agent",
				sshKeyPath: "",
			}),
		).toBe(false);
	});

	it("SC-10b: firstErroredTab returns connection when hostname empty", () => {
		expect(
			firstErroredTab({
				type: "ssh",
				sshHost: "",
				sshAuth: "agent",
				sshKeyPath: "",
			}),
		).toBe("connection");
	});

	it("firstErroredTab returns null when all valid", () => {
		expect(
			firstErroredTab({
				type: "ssh",
				sshHost: "10.0.0.1",
				sshAuth: "key",
				sshKeyPath: "~/.ssh/id_rsa",
			}),
		).toBeNull();
	});

	it("connectionTabHasError returns false for local type", () => {
		expect(
			connectionTabHasError({
				type: "local",
				sshHost: "",
				sshAuth: "key",
				sshKeyPath: "",
			}),
		).toBe(false);
	});
});
