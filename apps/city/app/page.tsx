import AmbientCity from "@/components/city/AmbientCity";
import { Brand } from "@/components/ui/Brand";
import { publicHouseholds, simReport } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export default function Home() {
  const { households, nodeHouseIds } = publicHouseholds();
  const repo = process.env.REPO_URL || "https://github.com";
  const sim = simReport();
  return (
    <main>
      <section className="landing-hero" aria-label="Porchlight">
        <AmbientCity households={households} nodeHouseIds={nodeHouseIds} />
        <div className="landing-shade" />
        <header className="landing-top">
          <Brand />
          <nav className="shell-nav" aria-label="Main">
            <a className="btn btn-quiet btn-small" href="/ops">Operations room</a>
            <a className="btn btn-quiet btn-small" href={repo} rel="noreferrer">Source code</a>
          </nav>
        </header>
        <div className="landing-copy">
          <h1>When the grid goes dark, the porch lights stay on.</h1>
          <p>
            Porchlight lets neighbours call for help with no power, no internet and no cell service, then gets the
            most vulnerable people reached first when the city comes back online.
          </p>
          <div className="actions">
            <a className="btn btn-porch" href="/present">Watch the story</a>
            <a className="btn btn-quiet" href="/ops">Open the operations room</a>
          </div>
        </div>
        <p className="landing-status" aria-hidden="true">
          <strong>Live loop</strong>A storm crosses the city, a neighbour calls for help, and the alert still arrives.
        </p>
      </section>

      <section className="how" aria-labelledby="how-h">
        <div className="how-head">
          <h2 id="how-h">Three hops from a button press to a knock on the door</h2>
          <p>Nothing here needs the internet until the very last step, and even that can wait.</p>
        </div>
        <ol className="how-steps">
          <li className="how-step">
            <h3>A resident presses a beacon</h3>
            <p>A small Arduino beacon signs the alert with its own key and sends it over Bluetooth to the nearest Porchlight node.</p>
          </li>
          <li className="how-step">
            <h3>Neighbours pass it on</h3>
            <p>Laptops and small computers in nearby homes verify it, store it, and gossip it onward. A dropped message is repaired on the next exchange.</p>
          </li>
          <li className="how-step">
            <h3>The city reaches the right door first</h3>
            <p>When any node reconnects, the city verifies every alert, ranks who needs help first, and calls people in their own language.</p>
          </li>
        </ol>
        <div className="proof">
          <div className="proof-item">
            <strong>180,000 homes in the dark</strong>
            <p>
              At the peak of the May 2022 derecho, more than half of Hydro Ottawa&apos;s customers lost power, and the
              utility temporarily took its own outage map offline.{" "}
              <a href="https://hydroottawa.com/en/about-us/regulatory-affairs/major-events/May-21-2022" rel="noreferrer">Hydro Ottawa</a>
            </p>
          </div>
          <div className="proof-item">
            <strong>{sim ? `${sim.results.eventsLost} of ${sim.results.eventsInjected} alerts lost` : "Tested to lose nothing"}</strong>
            <p>
              {sim
                ? `In simulation: ${sim.params.nodes} nodes, ${Math.round(sim.results.measuredLossRate * 100)}% of messages dropped, and the city link cut ${sim.params.cycles} times. A simulation, not a field test.`
                : "Run npm run sim:ci to measure it yourself."}
            </p>
          </div>
        </div>
      </section>

      <footer className="foot">
        <span>Porchlight is open source under the Apache 2.0 license.</span>
        <span>Built at Hack the Hill III, Ottawa, September 2026.</span>
      </footer>
    </main>
  );
}
