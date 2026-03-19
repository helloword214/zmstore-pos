import { test } from "@playwright/test";
import {
  AUTH_ROLE_ROUTING_SCENARIOS,
  bootstrapAuthRoleRoutingSession,
  expectAuthRoleRoutingHome,
  expectAuthRoleRoutingLoginRedirect,
  expectAuthRoleRoutingWrongLaneRedirect,
} from "./auth-role-routing-fixture";

for (const scenario of AUTH_ROLE_ROUTING_SCENARIOS) {
  test(`auth role routing: ${scenario.id} lands on the correct home and bounces from wrong lane`, async ({
    page,
  }) => {
    await bootstrapAuthRoleRoutingSession(page, scenario);
    await expectAuthRoleRoutingLoginRedirect(page, scenario);
    await expectAuthRoleRoutingHome(page, scenario);
    await expectAuthRoleRoutingWrongLaneRedirect(page, scenario);
  });
}
