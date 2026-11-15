import Image from "next/image";

interface Member {
  name: string;
  handle: string;
  photo?: string;
  owner?: boolean;
}

// As registered on the NASA Space Apps Challenge team page.
const CREW: Member[] = [
  {
    name: "Fariba Shahrouei",
    handle: "faribashahrouei1",
    photo: "/team/fariba-shahrouei.jpg",
    owner: true,
  },
  {
    name: "Pouya Latifiyan",
    handle: "pouyalatifiyan",
    photo: "/team/pouya-latifiyan.jpg",
  },
  {
    name: "Alireza Mosavi",
    handle: "alirezamosavi4130",
    photo: "/team/alireza-mosavi.jpg",
  },
  { name: "Fatemeh Iranmanesh", handle: "ftm.iranmanesh" },
  { name: "Mohammad Ali Hatefi", handle: "mahtfa" },
];

const initials = (name: string) => {
  const words = name.split(" ");
  return words[0][0] + words[words.length - 1][0];
};

export function Team() {
  return (
    <section className="wrap block" id="team">
      <div className="eyebrow">About the team</div>
      <h2 className="serif" data-reveal>
        The crew behind Falmex.
      </h2>
      <p className="sub" data-reveal>
        We are a multidisciplinary team passionate about space, science,
        technology, and solving real-world problems using NASA data. We bring
        diverse skills in AI/ML, data science, programming, design, scientific
        research, and storytelling to turn ideas into practical solutions. Our
        goal is to build meaningful, data-driven projects with real-world
        impact.
      </p>
      <ul className="crew">
        {CREW.map((m, i) => (
          <li key={m.handle} className="member" data-reveal>
            <div className="patch" style={{ ["--orbit" as string]: `${14 + i * 3}s` }}>
              <span className="ring" aria-hidden>
                <i />
              </span>
              {m.photo ? (
                <Image
                  src={m.photo}
                  alt={`Portrait of ${m.name}`}
                  width={320}
                  height={320}
                  sizes="(max-width: 900px) 120px, 148px"
                  quality={90}
                />
              ) : (
                <span className="mono serif" aria-hidden>
                  {initials(m.name)}
                </span>
              )}
            </div>
            <h3 className="serif">{m.name}</h3>
            <p className="handle">@{m.handle}</p>
            {m.owner && <span className="owner">Team owner</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
