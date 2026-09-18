import SwiftUI

struct Habit: Identifiable, Codable, Equatable {
    let id: UUID
    var name: String
    var colorName: String
    var completedDays: Set<Date>

    init(id: UUID = UUID(), name: String, colorName: String = "blue", completedDays: Set<Date> = []) {
        self.id = id
        self.name = name
        self.colorName = colorName
        self.completedDays = completedDays
    }

    var color: Color {
        switch colorName {
        case "red": return .red
        case "orange": return .orange
        case "yellow": return .yellow
        case "green": return .green
        case "purple": return .purple
        case "pink": return .pink
        default: return .blue
        }
    }

    func isCompleted(on date: Date) -> Bool {
        completedDays.contains(Calendar.current.startOfDay(for: date))
    }

    /// Number of consecutive days completed, counting back from today.
    var currentStreak: Int {
        var streak = 0
        var day = Calendar.current.startOfDay(for: Date())
        while completedDays.contains(day) {
            streak += 1
            guard let previous = Calendar.current.date(byAdding: .day, value: -1, to: day) else { break }
            day = previous
        }
        return streak
    }
}
