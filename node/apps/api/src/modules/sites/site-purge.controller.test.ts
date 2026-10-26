import { describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { SitesController } from "./sites.controller";
import { PasswordService } from "../auth/password.service";
import type { SitesRepository } from "./sites.repository";

const SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const caller = { sub: "11111111-1111-1111-1111-111111111111", permissions: ["site.delete"] } as never;

/** The site goes with everything in it only after the caller's own password (client, 26 Oct 2026). */
describe("SitesController delete-everything", () => {
  const setup = async () => {
    const passwords = new PasswordService();
    const stored = await passwords.hash("right-one");
    const repo = { passwordOf: vi.fn().mockResolvedValue(stored), purge: vi.fn().mockResolvedValue({ siteName: "Akwada" }) };
    return { repo, controller: new SitesController(repo as unknown as SitesRepository, passwords) };
  };

  it("refuses a wrong password and deletes nothing", async () => {
    const { repo, controller } = await setup();
    await expect(controller.purge(SITE, { password: "wrong" }, caller)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.purge).not.toHaveBeenCalled();
  });

  it("deletes the site with the caller's own password", async () => {
    const { repo, controller } = await setup();
    await controller.purge(SITE, { password: "right-one" }, caller);
    expect(repo.passwordOf).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
    expect(repo.purge).toHaveBeenCalledWith(SITE, "11111111-1111-1111-1111-111111111111");
  });
});
