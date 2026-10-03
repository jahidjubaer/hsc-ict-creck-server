import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true },
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    titleEn: { type: String },
    blurb: { type: String },
    icon: { type: String },
    color: { type: String }, // tailwind gradient classes, e.g. "from-violet-500 to-fuchsia-500"
    priority: { type: Boolean, default: false },
    learningOutcomes: [{ type: String }],
    bookPages: { type: String },
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Chapter = mongoose.model('Chapter', chapterSchema);
