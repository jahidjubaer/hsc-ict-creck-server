import mongoose from 'mongoose';

const keyTermSchema = new mongoose.Schema({ term: String, def: String }, { _id: false });

const topicSchema = new mongoose.Schema(
  {
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true, index: true },
    chapterNumber: { type: Number, required: true },
    slug: { type: String, required: true },
    order: { type: Number, required: true },
    title: { type: String, required: true },
    summary: { type: String },
    bookRef: { type: String }, // e.g. "৩.২.২ (পৃষ্ঠা ৮০–৮৫)"
    estMinutes: { type: Number, default: 10 },
    isFree: { type: Boolean, default: false }, // readable without trial/premium
    important: { type: Boolean, default: false }, // board-exam high-yield
    published: { type: Boolean, default: false },
    // Lesson body: array of typed blocks rendered by the client's BlockRenderer (see docs/CONTENT_GUIDE.md)
    blocks: { type: [mongoose.Schema.Types.Mixed], default: [] },
    keyTerms: { type: [keyTermSchema], default: [] },
    audioUrl: { type: String },
  },
  { timestamps: true }
);

topicSchema.index({ chapter: 1, slug: 1 }, { unique: true });
topicSchema.index({ chapter: 1, order: 1 });

export const Topic = mongoose.model('Topic', topicSchema);
