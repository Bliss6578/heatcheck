import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Crosshair,
  ThermometerSun,
  Wind,
} from "lucide-react";
import {
  PublicAction,
  PublicShell,
  publicAssets,
} from "@/components/PublicShell";
import { useState, type CSSProperties, type MouseEvent } from "react";

const previewCards = [
  {
    title: "Thermal",
    icon: ThermometerSun,
    copy: "Spatial heat signals across the operation.",
  },
  {
    title: "Environment",
    icon: Wind,
    copy: "Heat, humidity, wet-bulb, AQI, and solar context.",
  },
  {
    title: "Reasoning",
    icon: BrainCircuit,
    copy: "Governed response proposals with a durable record.",
  },
  {
    title: "Response",
    icon: Activity,
    copy: "Internal protocol activation and approval-aware actions.",
  },
  {
    title: "Urban context",
    icon: Crosshair,
    copy: "Built form and shade that explain repeat heat risk.",
  },
];

export default function Home() {
  const [thermalPoint, setThermalPoint] = useState({ x: 70, y: 44 });
  const trackThermalPoint = (event: MouseEvent<HTMLElement>) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setThermalPoint({
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    });
  };

  return (
    <PublicShell>
      <main>
        <section
          className="home-hero"
          onMouseMove={trackThermalPoint}
          style={
            {
              "--thermal-x": `${thermalPoint.x}%`,
              "--thermal-y": `${thermalPoint.y}%`,
            } as CSSProperties
          }
        >
          <div className="home-hero__grid" />
          <div className="home-hero__thermal-halo" />
          <div className="home-hero__thermal-sweep" />
          <div className="home-hero__copy">
            <p className="public-kicker">
              AUTONOMOUS HEAT INTELLIGENCE <i />
            </p>
            <h1>
              Heat doesn’t wait.
              <br />
              <span>Neither should you.</span>
            </h1>
            <p>
              Heatcheck detects changing conditions, calculates operational
              risk, and keeps the response record moving.
            </p>
            <div>
              <PublicAction>Start monitoring</PublicAction>
              <PublicAction href="/platform" subtle>
                Explore the platform
              </PublicAction>
            </div>
          </div>
          <div className="home-hero__image">
            <img
              src={publicAssets.terrain}
              alt="Abstract aerial terrain interpreted through thermal intelligence"
            />
            <div className="home-reading">
              <i />
              <span>Phoenix Operations Center</span>
              <strong>42.7°C</strong>
              <small>Critical heat zone · Risk 89</small>
            </div>
          </div>
        </section>
        <section className="home-loop public-section">
          <div className="home-loop__transect">
            <i />
            <i />
            <i />
            <span>THERMAL TRANSECT / LIVE</span>
          </div>
          <div className="section-intro">
            <p className="public-kicker">01 / OPERATING LOOP</p>
            <h2>From condition to a governed response.</h2>
            <p>
              One concise loop keeps environmental intelligence useful to
              operations.
            </p>
          </div>
          <div className="home-loop__steps">
            {[
              ["Observe", "Environmental signal"],
              ["Analyze", "Risk context"],
              ["Decide", "Policy logic"],
              ["Act", "Response record"],
              ["Verify", "Re-evaluation"],
            ].map(([step, label], index) => (
              <article key={step}>
                <span>0{index + 1}</span>
                <h3>{step}</h3>
                <p>{label}</p>
                <ChevronRight />
                <b />
              </article>
            ))}
          </div>
          <PublicAction href="/platform" subtle>
            Explore the platform
          </PublicAction>
        </section>
        <section className="home-intelligence">
          <div className="home-intelligence__field">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="public-section">
            <div className="section-intro section-intro--light">
              <p className="public-kicker">02 / INTELLIGENCE</p>
              <h2>Built to understand heat.</h2>
              <p>
                Five connected layers turn a changing environment into a
                complete operational picture.
              </p>
            </div>
            <div className="home-intelligence__cards">
              {previewCards.map(({ title, icon: Icon, copy }, index) => (
                <article key={title} data-layer={index + 1}>
                  <div>
                    <span>0{index + 1}</span>
                    <Icon size={20} />
                  </div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                  <i />
                </article>
              ))}
            </div>
            <PublicAction href="/intelligence" subtle>
              See every intelligence layer
            </PublicAction>
          </div>
        </section>
        <section className="home-response public-section">
          <div>
            <p className="public-kicker">03 / RESPONSE STORY</p>
            <h2>One heat spike. A clearer next move.</h2>
            <p>
              At Phoenix Distribution Center, Heatcheck identifies a severe
              condition, records the risk factors, and routes a response through
              the operation.
            </p>
            <ul>
              {[
                "Hotspot identified",
                "Exposure classified",
                "Response protocol activated",
                "Outcome re-evaluated",
              ].map(item => (
                <li key={item}>
                  <Check size={15} />
                  {item}
                </li>
              ))}
            </ul>
            <PublicAction href="/solutions">
              Explore field solutions
            </PublicAction>
          </div>
          <div className="home-response__image">
            <img
              src={publicAssets.operations}
              alt="Thermal interpretation of a logistics operation"
            />
            <div className="home-response__scan" />
            <div className="home-response__markers">
              <i />
              <i />
              <i />
            </div>
            <span>SEVERE / 87</span>
          </div>
        </section>
        <section className="home-solutions public-section">
          <div className="section-intro">
            <p className="public-kicker">04 / SOLUTIONS</p>
            <h2>Heat intelligence for real operations.</h2>
          </div>
          <div>
            {[
              "Logistics",
              "Construction",
              "Warehousing",
              "Campuses & cities",
            ].map((solution, index) => (
              <a href="/solutions" key={solution}>
                <span>0{index + 1}</span>
                <strong>{solution}</strong>
                <ArrowUpRight />
              </a>
            ))}
          </div>
        </section>
        <section className="home-cta">
          <div className="home-cta__network">
            <i />
            <i />
            <i />
            <i />
            <span>FIELD NETWORK / READY</span>
          </div>
          <p className="public-kicker">READY WHEN THE TEMPERATURE RISES</p>
          <h2>Make heat response part of the operation.</h2>
          <p>
            Calibrate a location, see the decision record, and build the
            response from there.
          </p>
          <PublicAction>Start Heatcheck</PublicAction>
        </section>
      </main>
    </PublicShell>
  );
}
