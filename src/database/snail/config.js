import mongoose from 'mongoose';

export function createConfigModel(connection) {
    return connection.model(
        'Config',
        new mongoose.Schema(
            {
                _id: String,
                value: mongoose.Schema.Types.Mixed
            },
            { timestamps: true }
        )
    );
}
