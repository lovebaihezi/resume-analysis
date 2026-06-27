import { describe, expect, it } from "vitest";
import {
    collectResumeFieldTokens,
    compactResumeTokenPatch,
    createResumeFieldToken,
    parseResumeFieldTags,
    ResumeFieldTagParser,
    resumeAnalysisToFieldTags,
    resumeFromTokenPatch,
} from "../../src/shared/resumeStream";
import type { ResumeAnalysis } from "../../src/shared/types";

const fullResume: ResumeAnalysis = {
    rawText:
        "Asuka builds AI resume workflows with React, XState, and Cloudflare Workers.",
    basic: {
        email: "asuka@example.com",
        name: "Asuka",
        phone: "+1-555-0100",
        socialMedia: [
            { link: "https://github.com/asuka", name: "GitHub" },
            { link: "https://linkedin.com/in/asuka", name: "LinkedIn" },
        ],
    },
    edu: [
        {
            awards: [
                { name: "Dean List", value: "2021" },
                { name: "Scholarship", value: "Merit" },
            ],
            degree: "Master",
            experiences: [
                { des: "Human-computer interaction research." },
                { des: "Teaching assistant for distributed systems." },
            ],
            school: "National University",
        },
        {
            awards: [],
            degree: "Bachelor",
            experiences: [{ des: "Programming languages capstone." }],
            school: "City College",
        },
    ],
    project: [
        {
            des: "AI-assisted resume parsing.",
            duration: ["2023-01-01", "2024-01-01"],
            name: "Resume Analyzer",
            role: "maintainer",
            type: "open-source",
        },
        {
            des: "Personal dashboard for job applications.",
            duration: ["2022-06-01", "2022-09-01"],
            name: "Interview Tracker",
            role: "owner",
            type: "hobby",
        },
    ],
    skills: [
        { des: "Frontend architecture", name: "React" },
        { des: "Edge APIs", name: "Cloudflare Workers" },
        { des: "State machines", name: "XState" },
    ],
    work: [
        {
            company: "Edge Apps",
            des: "Built resume analysis workflows with React and Workers.",
            duration: ["2020-01-01", "2024-03-01"],
            level: "senior",
            location: "hybrid",
            role: "Frontend Engineer",
            type: "full-time",
        },
        {
            company: "Startup Labs",
            des: "Shipped prototype hiring tools.",
            duration: ["2019-06-01", "2019-09-01"],
            level: "intern",
            location: "remote",
            role: "Product Engineering Intern",
            type: "intern",
        },
    ],
};

describe("streamed resume XML token parsing", () => {
    it("turns a full flat XML resume into order-independent token patches and final JSON", () => {
        const tags = resumeAnalysisToFieldTags(fullResume);
        const orderedTokens = parseResumeFieldTags(tags.join("\n"));
        const shuffledTokens = parseResumeFieldTags(shuffle(tags).join("\n"));

        expect(orderedTokens.length).toBeGreaterThan(30);
        expect(
            createResumeFieldToken("edu.1.school", "City College").patch,
        ).toEqual({
            edu: [undefined, { school: "City College" }],
        });

        expect(
            resumeFromTokenPatch(collectResumeFieldTokens(orderedTokens)),
        ).toEqual(fullResume);
        expect(
            resumeFromTokenPatch(collectResumeFieldTokens(shuffledTokens)),
        ).toEqual(fullResume);
    });

    it("collects incomplete sparse XML lists and filters missing array entries in final JSON", () => {
        const tokens = parseResumeFieldTags(
            [
                "<basic.name>Incomplete Candidate</basic.name>",
                "<edu.1.school>Late Indexed University</edu.1.school>",
                "<work.0.company>Partial Co</work.0.company>",
                "<work.0.duration.0>2024-01-01</work.0.duration.0>",
                "<skills.2.name>TypeScript</skills.2.name>",
                "<project.0.name>Unclosed Project",
                "<bad path>ignored</bad path>",
                "<work.0.company>wrong close</work.0.role>",
            ].join("\n"),
        );
        const collected = collectResumeFieldTokens(tokens);

        expect(tokens.map((token) => token.path)).toEqual([
            "basic.name",
            "edu.1.school",
            "work.0.company",
            "work.0.duration.0",
            "skills.2.name",
        ]);
        expect(compactResumeTokenPatch(collected)).toMatchObject({
            basic: { name: "Incomplete Candidate" },
            edu: [{ school: "Late Indexed University" }],
            skills: [{ name: "TypeScript" }],
            work: [{ company: "Partial Co", duration: ["2024-01-01"] }],
        });
        expect(resumeFromTokenPatch(collected)).toEqual({
            basic: {
                email: "",
                name: "Incomplete Candidate",
                phone: "",
                socialMedia: [],
            },
            edu: [
                {
                    awards: [],
                    degree: "",
                    experiences: [],
                    school: "Late Indexed University",
                },
            ],
            project: [],
            rawText: "",
            skills: [{ des: "", name: "TypeScript" }],
            work: [
                {
                    company: "Partial Co",
                    duration: ["2024-01-01"],
                },
            ],
        });
    });

    it("emits tokens only after complete matching tags arrive across chunk boundaries", () => {
        const parser = new ResumeFieldTagParser();

        expect(parser.push("<basic.na")).toEqual([]);
        expect(parser.push("me>As")).toEqual([]);
        expect(parser.push("uka</basic.name><skills.0")).toEqual([
            createResumeFieldToken("basic.name", "Asuka"),
        ]);
        expect(parser.push(".name>React</skills.0.name>")).toEqual([
            createResumeFieldToken("skills.0.name", "React"),
        ]);
        expect(parser.push("<work.0.role>Engineer</work.0.company>")).toEqual(
            [],
        );
        expect(parser.flush()).toEqual([]);
    });
});

function shuffle(values: string[]): string[] {
    return values
        .map((value, index) => ({
            rank: (index * 17 + 11) % values.length,
            value,
        }))
        .toSorted((left, right) => left.rank - right.rank)
        .map(({ value }) => value);
}
