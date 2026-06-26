import type { JobDescription, ResumeAnalysis } from "../../src/shared/types";

export const sampleResume: ResumeAnalysis = {
    rawText:
        "Ava Chen\nava@example.com\nSenior frontend engineer with React and Cloudflare Workers experience.",
    basic: {
        name: "Ava Chen",
        email: "ava@example.com",
        phone: "+1-555-0100",
        socialMedia: [{ name: "GitHub", link: "https://github.com/ava" }],
    },
    edu: [
        {
            school: "National University",
            degree: "Master",
            awards: [{ name: "Dean List", value: "2021" }],
            experiences: [{ des: "Human-computer interaction research." }],
        },
    ],
    work: [
        {
            company: "Edge Apps",
            duration: ["2020-01-01", "2024-03-01"],
            type: "full-time",
            location: "hybrid",
            level: "senior",
            role: "Frontend Engineer",
            des: "Built resume analysis workflows with React and Workers.",
        },
    ],
    project: [
        {
            name: "Resume Analyzer",
            duration: ["2023-01-01", "2024-01-01"],
            type: "open-source",
            role: "maintainer",
            des: "AI-assisted resume parsing.",
        },
    ],
    skills: [
        { name: "React", des: "Frontend architecture" },
        { name: "Cloudflare Workers", des: "Edge APIs" },
        { name: "XState", des: "State machines" },
    ],
};

export const sampleJobDescription: JobDescription = {
    id: "senior-frontend-engineer",
    title: "Senior Frontend Engineer",
    rawText:
        "Senior frontend engineer role requiring React, XState, Cloudflare Workers, and accessibility experience.",
    des: "Build accessible fullstack resume analysis product workflows.",
    tags: ["frontend", "cloudflare", "ai"],
    requiredSkills: ["React", "XState", "Cloudflare Workers"],
    requiredExperiences: ["5+ years frontend engineering", "Accessibility"],
};
