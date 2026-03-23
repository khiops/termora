import type {
	Channel,
	ChannelGroup,
	ChannelStatus,
	Host,
	HostArch,
	HostGroup,
	HostLaunchProfileOverride,
	HostOs,
	LaunchProfile,
	Session,
	SessionStatus,
} from "@nexterm/shared";
import type Database from "better-sqlite3";

import { ChannelGroupsDAL } from "./channel-groups-dal.js";
import { ChannelsDAL } from "./channels-dal.js";
import { HostsDAL } from "./hosts-dal.js";
import { LaunchProfilesDAL } from "./launch-profiles-dal.js";
import type {
	CreateChannelInput,
	CreateHostInput,
	CreateSessionInput,
	PairingCodeRow,
} from "./meta-types.js";
import { PairRateLimitsDAL } from "./pair-rate-limits-dal.js";
import { PairingCodesDAL } from "./pairing-codes-dal.js";
import { SessionsDAL } from "./sessions-dal.js";

// Re-export input types so existing callers can continue importing from meta.ts
export type { CreateChannelInput, CreateHostInput, CreateSessionInput, PairingCodeRow };

// Re-export sub-DAL classes for consumers that want direct access
export {
	ChannelGroupsDAL,
	ChannelsDAL,
	HostsDAL,
	LaunchProfilesDAL,
	PairRateLimitsDAL,
	PairingCodesDAL,
	SessionsDAL,
};

// ─── MetaDAL — facade over domain-specific DALs ──────────────────────────────

export class MetaDAL {
	readonly hosts: HostsDAL;
	readonly channelGroups: ChannelGroupsDAL;
	readonly sessions: SessionsDAL;
	readonly channels: ChannelsDAL;
	readonly launchProfiles: LaunchProfilesDAL;
	readonly pairingCodes: PairingCodesDAL;
	readonly pairRateLimits: PairRateLimitsDAL;

	constructor(private db: Database.Database) {
		this.hosts = new HostsDAL(db);
		this.channelGroups = new ChannelGroupsDAL(db);
		this.sessions = new SessionsDAL(db);
		this.channels = new ChannelsDAL(db);
		this.launchProfiles = new LaunchProfilesDAL(db);
		this.pairingCodes = new PairingCodesDAL(db);
		this.pairRateLimits = new PairRateLimitsDAL(db);
	}

	// ─── Hosts ──────────────────────────────────────────────────────────────

	createHost(input: CreateHostInput): Host {
		return this.hosts.createHost(input);
	}

	getHost(id: string): Host | undefined {
		return this.hosts.getHost(id);
	}

	getHostByLabel(label: string): Host | undefined {
		return this.hosts.getHostByLabel(label);
	}

	listHosts(limit?: number, offset?: number): Host[] {
		return this.hosts.listHosts(limit, offset);
	}

	countHosts(): number {
		return this.hosts.countHosts();
	}

	updateHost(id: string, input: Partial<CreateHostInput>): Host {
		return this.hosts.updateHost(id, input);
	}

	updateHostOsArch(id: string, os: HostOs, arch: HostArch): void {
		return this.hosts.updateHostOsArch(id, os, arch);
	}

	getHostFingerprint(hostId: string): string | null {
		return this.hosts.getHostFingerprint(hostId);
	}

	updateHostFingerprint(hostId: string, fingerprint: string): void {
		return this.hosts.updateHostFingerprint(hostId, fingerprint);
	}

	deleteHost(id: string): boolean {
		return this.hosts.deleteHost(id);
	}

	importHosts(inputs: CreateHostInput[]): Host[] {
		return this.hosts.importHosts(inputs);
	}

	reorderHosts(groupId: string | null, hostIds: string[]): void {
		return this.hosts.reorderHosts(groupId, hostIds);
	}

	duplicateHost(id: string): Host | null {
		return this.hosts.duplicateHost(id);
	}

	renameHostGroup(oldName: string, newName: string): number {
		return this.hosts.renameHostGroup(oldName, newName);
	}

	deleteHostGroup(name: string): number {
		return this.hosts.deleteHostGroup(name);
	}

	listHostGroups(): string[] {
		return this.hosts.listHostGroups();
	}

	listHostGroupEntities(limit?: number, offset?: number): HostGroup[] {
		return this.hosts.listHostGroupEntities(limit, offset);
	}

	countHostGroupEntities(): number {
		return this.hosts.countHostGroupEntities();
	}

	createHostGroup(name: string, color?: string | null): HostGroup {
		return this.hosts.createHostGroup(name, color);
	}

	getHostGroupEntity(id: string): HostGroup | null {
		return this.hosts.getHostGroupEntity(id);
	}

	updateHostGroup(id: string, fields: { name?: string; color?: string | null }): HostGroup | null {
		return this.hosts.updateHostGroup(id, fields);
	}

	deleteHostGroupEntity(id: string): boolean {
		return this.hosts.deleteHostGroupEntity(id);
	}

	reorderHostGroups(groupIds: string[]): void {
		return this.hosts.reorderHostGroups(groupIds);
	}

	migrateHostGroupData(): void {
		return this.hosts.migrateHostGroupData();
	}

	getHostProfile(id: string): string | null {
		return this.hosts.getHostProfile(id);
	}

	updateHostProfile(id: string, profileJson: string | null): boolean {
		return this.hosts.updateHostProfile(id, profileJson);
	}

	updateHostDiscoveredShells(hostId: string, shells: string[], defaultShell?: string): void {
		return this.hosts.updateHostDiscoveredShells(hostId, shells, defaultShell);
	}

	// ─── Groups ─────────────────────────────────────────────────────────────

	listGroups(hostId: string): ChannelGroup[] {
		return this.channelGroups.listGroups(hostId);
	}

	createGroup(hostId: string, name: string): ChannelGroup {
		return this.channelGroups.createGroup(hostId, name);
	}

	reorderGroups(hostId: string, groupIds: string[]): void {
		return this.channelGroups.reorderGroups(hostId, groupIds);
	}

	renameGroup(id: string, name: string): boolean {
		return this.channelGroups.renameGroup(id, name);
	}

	deleteGroup(id: string): boolean {
		return this.channelGroups.deleteGroup(id);
	}

	updateChannelGroupId(channelId: string, groupId: string | null): boolean {
		return this.channelGroups.updateChannelGroupId(channelId, groupId);
	}

	// ─── Sessions ───────────────────────────────────────────────────────────

	createSession(input: CreateSessionInput): void {
		return this.sessions.createSession(input);
	}

	getSession(id: string): Session | undefined {
		return this.sessions.getSession(id);
	}

	listSessions(hostId?: string): Session[] {
		return this.sessions.listSessions(hostId);
	}

	updateSessionStatus(id: string, status: SessionStatus): void {
		return this.sessions.updateSessionStatus(id, status);
	}

	deleteSession(id: string): void {
		return this.sessions.deleteSession(id);
	}

	markAllSessionsClosed(): number {
		return this.sessions.markAllSessionsClosed();
	}

	markHostSessionDisconnected(hostId: string): number {
		return this.sessions.markHostSessionDisconnected(hostId);
	}

	// ─── Channels ───────────────────────────────────────────────────────────

	createChannel(input: CreateChannelInput): void {
		return this.channels.createChannel(input);
	}

	getChannel(id: string): Channel | undefined {
		return this.channels.getChannel(id);
	}

	getChannelWithHost(
		channelId: string,
	): { channel: Channel; hostId: string; hostType: string } | null {
		return this.channels.getChannelWithHost(channelId);
	}

	listChannels(sessionId?: string): Channel[] {
		return this.channels.listChannels(sessionId);
	}

	updateChannelStatus(id: string, status: ChannelStatus, exitCode?: number): void {
		return this.channels.updateChannelStatus(id, status, exitCode);
	}

	updateChannelDimensions(id: string, cols: number, rows: number): boolean {
		return this.channels.updateChannelDimensions(id, cols, rows);
	}

	updateChannelTitle(id: string, title: string | null): boolean {
		return this.channels.updateChannelTitle(id, title);
	}

	updateDynamicTitle(channelId: string, title: string): void {
		return this.channels.updateDynamicTitle(channelId, title);
	}

	updateProcessTitle(channelId: string, title: string): void {
		return this.channels.updateProcessTitle(channelId, title);
	}

	updateChannelConfig(
		channelId: string,
		config: {
			icon?: string | null;
			shell?: string | null;
			args?: string[];
			cwd?: string | null;
			directProcess?: boolean;
		},
	): boolean {
		return this.channels.updateChannelConfig(channelId, config);
	}

	deleteChannel(id: string): void {
		return this.channels.deleteChannel(id);
	}

	getChannelProfile(id: string): string | null {
		return this.channels.getChannelProfile(id);
	}

	updateChannelProfile(id: string, profileJson: string | null): boolean {
		return this.channels.updateChannelProfile(id, profileJson);
	}

	setWelcomeChannel(channelId: string): boolean {
		return this.channels.setWelcomeChannel(channelId);
	}

	clearWelcomeChannel(channelId: string): boolean {
		return this.channels.clearWelcomeChannel(channelId);
	}

	getWelcomeChannel(hostId: string): Channel | undefined {
		return this.channels.getWelcomeChannel(hostId);
	}

	markAllChannelsDead(): number {
		return this.channels.markAllChannelsDead();
	}

	listAliveChannelsWithHost(): Array<{
		id: string;
		sessionId: string;
		shell: string;
		args: string[];
		cwd: string | null;
		cols: number;
		rows: number;
		status: string;
		hostId: string;
		hostType: string;
		directProcess: boolean;
	}> {
		return this.channels.listAliveChannelsWithHost();
	}

	markHostChannelsOrphan(hostId: string): number {
		return this.channels.markHostChannelsOrphan(hostId);
	}

	listStaleDeadChannelIds(before: string): string[] {
		return this.channels.listStaleDeadChannelIds(before);
	}

	updateCacheIndex(channelId: string, snapshotChunkId: string, lastSeq: number): void {
		return this.channels.updateCacheIndex(channelId, snapshotChunkId, lastSeq);
	}

	// ─── Pairing Codes ───────────────────────────────────────────────────────

	createPairingCode(id: string, code: string, createdAt: string, expiresAt: string): void {
		return this.pairingCodes.createPairingCode(id, code, createdAt, expiresAt);
	}

	getPairingCodeByCode(code: string): PairingCodeRow | undefined {
		return this.pairingCodes.getPairingCodeByCode(code);
	}

	markPairingCodeUsed(id: string, usedAt: string, usedByIp: string): void {
		return this.pairingCodes.markPairingCodeUsed(id, usedAt, usedByIp);
	}

	countActivePairingCodes(): number {
		return this.pairingCodes.countActivePairingCodes();
	}

	cleanExpiredPairingCodes(): void {
		return this.pairingCodes.cleanExpiredPairingCodes();
	}

	// ─── Pair Rate Limits ────────────────────────────────────────────────────

	checkAndIncrementPairRate(ip: string, maxAttempts: number, windowMs: number): boolean {
		return this.pairRateLimits.checkAndIncrement(ip, maxAttempts, windowMs);
	}

	cleanExpiredPairRates(windowMs: number): void {
		return this.pairRateLimits.cleanExpired(windowMs);
	}

	// ─── Launch Profiles ─────────────────────────────────────────────────────

	createLaunchProfile(input: Omit<LaunchProfile, "id" | "createdAt" | "updatedAt">): LaunchProfile {
		return this.launchProfiles.createLaunchProfile(input);
	}

	getLaunchProfile(id: string): LaunchProfile | undefined {
		return this.launchProfiles.getLaunchProfile(id);
	}

	getLaunchProfileByName(name: string): LaunchProfile | undefined {
		return this.launchProfiles.getLaunchProfileByName(name);
	}

	listLaunchProfiles(limit?: number, offset?: number): LaunchProfile[] {
		return this.launchProfiles.listLaunchProfiles(limit, offset);
	}

	countLaunchProfiles(): number {
		return this.launchProfiles.countLaunchProfiles();
	}

	updateLaunchProfile(id: string, updates: Partial<LaunchProfile>): LaunchProfile | undefined {
		return this.launchProfiles.updateLaunchProfile(id, updates);
	}

	deleteLaunchProfile(id: string): boolean {
		return this.launchProfiles.deleteLaunchProfile(id);
	}

	reorderLaunchProfiles(ids: string[]): void {
		return this.launchProfiles.reorderLaunchProfiles(ids);
	}

	listHostProfiles(
		hostId: string,
		hostOs: string,
	): Array<LaunchProfile & { overrideType?: string; effectiveSort: number }> {
		return this.launchProfiles.listHostProfiles(hostId, hostOs);
	}

	upsertHostProfileOverride(
		hostId: string,
		profileId: string,
		overrideType: string,
		sortOrder?: number,
	): void {
		return this.launchProfiles.upsertHostProfileOverride(
			hostId,
			profileId,
			overrideType,
			sortOrder,
		);
	}

	deleteHostProfileOverride(hostId: string, profileId: string): boolean {
		return this.launchProfiles.deleteHostProfileOverride(hostId, profileId);
	}

	getHostLaunchProfileOverride(
		hostId: string,
		profileId: string,
	): HostLaunchProfileOverride | undefined {
		return this.launchProfiles.getHostLaunchProfileOverride(hostId, profileId);
	}
}
