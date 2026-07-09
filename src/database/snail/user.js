import mongoose from 'mongoose';

export function createUserModel(connection) {
    const schema = new mongoose.Schema(
        {
            _id: { type: String, required: true },
            ticketMarket: {
                marketAgreedAt: Date,
                sellerAgreedAt: Date,
                marketBannedAt: Date
            }
        },
        { timestamps: true }
    );

    return connection.model('User', schema);
}
