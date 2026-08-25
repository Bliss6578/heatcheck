# Heatcheck Flow Polish Plan

The motion polish will keep Heatcheck’s cinematic character focused rather than busy. The home page will receive a coordinated load-in sequence: hero label, headline, supporting copy, actions, then terrain reading. Each public section will enter with one short directional reveal instead of many concurrent effects. Interactive rows and cards will use a brief active-state underline or signal shift so the user always sees where the next action leads.

The Intelligence sequence will keep its active spotlit layer, but its navigator will gain an immediate selected-state response and the spotlight will crossfade with a compact scan pass. Primary actions will retain short press feedback. Public navigation will close predictably after route selection, and the signed-in return control will remain a direct in-app route to the public home page without any logout behavior.

Motion timing will use 160–260 ms for controls, 450–700 ms for major reveals, and 60–80 ms for stagger steps. Reduced-motion preferences will retain visual state changes while removing travel, scan, and staged entrance animation.

## Validation Record

The refined home, Intelligence, and signed-in product entry were reviewed at desktop and mobile breakpoints. The production build and the Field Signal motion-contract test pass. The Intelligence spotlight was exercised by selecting the Decision engine layer, which updated the active reading and content panel. The signed-in return flow was tested and accepted by the user. Browser inspection in this environment can reliably verify rendered end states and interaction outcomes, but it does not expose an observable animation timeline in console output; reduced-motion validation therefore remains covered by the explicit CSS contract test and implementation guard.
